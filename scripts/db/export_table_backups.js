/**
 * 逐表备份脚本（纯 Node.js，不依赖 mysqldump）
 *
 * 为当前数据库中的每张表分别导出：
 *   1) .schema.sql  表结构快照
 *   2) .data.sql    表数据快照
 *
 * 用法：
 *   node scripts/db/export_table_backups.js
 *   node scripts/db/export_table_backups.js -o backups/custom-dir
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const mysqlPromise = require('mysql2/promise');
const {
  createDbConfig,
  projectRoot,
  nowCSTTimestamp,
  nowCSTReadable,
} = require('../shared/db_env');

const BACKUP_PREFIX = 'table-backup-';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function quoteIdentifier(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function escapeValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return mysql.escape(normalizeValue(value));
}

function buildInsert(tableName, columns, row) {
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  const values = columns.map((column) => escapeValue(row[column])).join(', ');
  return `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${values});`;
}

function withSemicolon(sql) {
  return /;\s*$/.test(sql) ? sql : `${sql};`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let outputDir = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-o' || args[i] === '--output-dir') && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    } else if (!args[i].startsWith('-')) {
      outputDir = path.resolve(args[i]);
    }
  }

  if (!outputDir) {
    outputDir = path.join(projectRoot, 'backups', `${BACKUP_PREFIX}${nowCSTTimestamp()}`);
  }

  return { outputDir };
}

async function listTables(connection) {
  const [rows] = await connection.query('SHOW TABLES');
  return rows.map((row) => String(Object.values(row)[0]));
}

async function getTableSnapshot(connection, tableName) {
  const quotedTable = quoteIdentifier(tableName);

  const [createRows] = await connection.query(`SHOW CREATE TABLE ${quotedTable}`);
  const createSql = createRows[0]?.['Create Table'] || createRows[0]?.['Create View'];
  if (!createSql) {
    throw new Error(`Unable to read CREATE statement for table: ${tableName}`);
  }

  const [columnRows] = await connection.query(`SHOW FULL COLUMNS FROM ${quotedTable}`);
  const columns = columnRows.map((row) => String(row.Field));

  const [indexRows] = await connection.query(`SHOW INDEX FROM ${quotedTable}`);
  const primaryKeyColumns = indexRows
    .filter((row) => row.Key_name === 'PRIMARY')
    .sort((left, right) => Number(left.Seq_in_index) - Number(right.Seq_in_index))
    .map((row) => String(row.Column_name));

  const orderBy = primaryKeyColumns.length > 0
    ? ` ORDER BY ${primaryKeyColumns.map(quoteIdentifier).join(', ')}`
    : '';
  const [dataRows] = await connection.query(`SELECT * FROM ${quotedTable}${orderBy}`);

  const [statusRows] = await connection.query('SHOW TABLE STATUS LIKE ?', [tableName]);
  const autoIncrement = statusRows[0]?.Auto_increment ?? null;

  return {
    tableName,
    createSql,
    columns,
    primaryKeyColumns,
    rows: dataRows,
    autoIncrement,
  };
}

function writeTableFiles(outputDir, databaseName, snapshot, index) {
  const filePrefix = `${String(index + 1).padStart(2, '0')}-${snapshot.tableName}`;
  const schemaFile = `${filePrefix}.schema.sql`;
  const dataFile = `${filePrefix}.data.sql`;

  const schemaLines = [
    `-- Table schema backup (${snapshot.tableName})`,
    `-- Database: ${databaseName}`,
    `-- Generated: ${nowCSTReadable()} (UTC+8)`,
    '',
    'SET NAMES utf8mb4;',
    '',
    withSemicolon(snapshot.createSql),
    '',
  ];

  const dataLines = [
    `-- Table data backup (${snapshot.tableName})`,
    `-- Database: ${databaseName}`,
    `-- Generated: ${nowCSTReadable()} (UTC+8)`,
    `-- Rows: ${snapshot.rows.length}`,
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
    `DELETE FROM ${quoteIdentifier(snapshot.tableName)};`,
    '',
  ];

  for (const row of snapshot.rows) {
    dataLines.push(buildInsert(snapshot.tableName, snapshot.columns, row));
  }

  if (snapshot.autoIncrement !== null) {
    dataLines.push('');
    dataLines.push(`ALTER TABLE ${quoteIdentifier(snapshot.tableName)} AUTO_INCREMENT = ${Number(snapshot.autoIncrement)};`);
  }

  dataLines.push('SET FOREIGN_KEY_CHECKS = 1;');
  dataLines.push('');

  fs.writeFileSync(path.join(outputDir, schemaFile), schemaLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outputDir, dataFile), dataLines.join('\n'), 'utf8');

  return { schemaFile, dataFile };
}

async function main() {
  const { outputDir } = parseArgs();
  const dbConfig = createDbConfig({ dateStrings: true });
  const connection = await mysqlPromise.createConnection(dbConfig);

  ensureDir(outputDir);

  try {
    const tableNames = await listTables(connection);
    const manifest = {
      database: dbConfig.database,
      generatedAt: `${nowCSTReadable()} (UTC+8)`,
      outputDir: path.relative(projectRoot, outputDir),
      tables: [],
    };

    for (let index = 0; index < tableNames.length; index += 1) {
      const tableName = tableNames[index];
      const snapshot = await getTableSnapshot(connection, tableName);
      const files = writeTableFiles(outputDir, dbConfig.database, snapshot, index);

      manifest.tables.push({
        tableName,
        rowCount: snapshot.rows.length,
        primaryKeyColumns: snapshot.primaryKeyColumns,
        autoIncrement: snapshot.autoIncrement,
        schemaFile: files.schemaFile,
        dataFile: files.dataFile,
      });

      console.log(`[table-backup] ${tableName}: ${snapshot.rows.length} rows`);
    }

    fs.writeFileSync(
      path.join(outputDir, '00-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    console.log(`[table-backup] Backup complete -> ${path.relative(projectRoot, outputDir)}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});