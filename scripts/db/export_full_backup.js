/**
 * 全量数据备份脚本（纯 Node.js，不依赖 mysqldump）
 *
 * 导出 anime + watch_history + users 三张表为 SQL INSERT 文件。
 * users 表的密码哈希会一起导出，备份文件不应提交到 Git 仓库。
 *
 * 用法：
 *   node scripts/db/export_full_backup.js                 # 默认输出到 backups/
 *   node scripts/db/export_full_backup.js --no-users      # 不包含 users 表
 *   node scripts/db/export_full_backup.js -o path/to.sql  # 指定输出路径
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const mysqlPromise = require('mysql2/promise');
const { createDbConfig, projectRoot, nowCSTTimestamp, nowCSTReadable } = require('../shared/db_env');
const backupsDir = path.join(projectRoot, 'backups');

// ---------------------------------------------------------------------------
// SQL value helpers
// ---------------------------------------------------------------------------

function normalizeJsonValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const JSON_COLUMNS = new Set(['tags', 'cast', 'cast_aliases']);

function escapeValue(column, value) {
  if (value === null || value === undefined) return 'NULL';
  if (JSON_COLUMNS.has(column)) return mysql.escape(normalizeJsonValue(value));
  return mysql.escape(value);
}

function buildInsert(table, columns, row) {
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  const vals = columns.map((c) => escapeValue(c, row[c])).join(', ');
  return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let outputFile = null;
  let includeUsers = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-users') {
      includeUsers = false;
    } else if (args[i] === '-o' && args[i + 1]) {
      outputFile = path.resolve(args[++i]);
    } else if (!args[i].startsWith('-')) {
      outputFile = path.resolve(args[i]);
    }
  }

  if (!outputFile) {
    const ts = nowCSTTimestamp();
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    outputFile = path.join(backupsDir, `full-backup-${ts}.sql`);
  }

  return { outputFile, includeUsers };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { outputFile, includeUsers } = parseArgs();

  const connection = await mysqlPromise.createConnection(createDbConfig());

  try {
    // ---- anime ----
    const [animeRows] = await connection.query(`
      SELECT
        id, title, original_title, coverUrl, status, score,
        progress, totalEpisodes, durationMinutes, notes, tags, summary,
        DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
        DATE_FORMAT(premiere_date, '%Y-%m-%d') AS premiere_date,
        cast, cast_aliases, isFinished,
        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
      FROM anime ORDER BY id ASC
    `);

    const animeColumns = [
      'id', 'title', 'original_title', 'coverUrl', 'status', 'score',
      'progress', 'totalEpisodes', 'durationMinutes', 'notes', 'tags', 'summary',
      'start_date', 'end_date', 'premiere_date',
      'cast', 'cast_aliases', 'isFinished', 'createdAt', 'updatedAt',
    ];

    // ---- watch_history ----
    const [historyRows] = await connection.query(`
      SELECT
        id, animeId, animeTitle, episode,
        DATE_FORMAT(watchedAt, '%Y-%m-%d %H:%i:%s') AS watchedAt
      FROM watch_history ORDER BY watchedAt ASC, id ASC
    `);

    const historyColumns = ['id', 'animeId', 'animeTitle', 'episode', 'watchedAt'];

    // ---- users (optional) ----
    let userRows = [];
    const userColumns = ['id', 'username', 'password_hash', 'name', 'role',
      'createdAt', 'updatedAt'];

    if (includeUsers) {
      const [rows] = await connection.query(`
        SELECT
          id, username, password_hash, name, role,
          DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
          DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
        FROM users ORDER BY id ASC
      `);
      userRows = rows;
    }

    // ---- build output ----
    const lines = [
      '-- Full database backup (export_full_backup.js)',
      `-- Database: ${process.env.MYSQL_DATABASE}`,
      `-- Generated: ${nowCSTReadable()} (UTC+8)`,
      `-- Tables: anime (${animeRows.length}), watch_history (${historyRows.length})${includeUsers ? `, users (${userRows.length})` : ''}`,
      '',
      'SET NAMES utf8mb4;',
      'SET FOREIGN_KEY_CHECKS = 0;',
      '',
      '-- ============================================================',
      '-- anime',
      '-- ============================================================',
      'DELETE FROM `watch_history`;',
      'DELETE FROM `anime`;',
      '',
    ];

    for (const row of animeRows) {
      lines.push(buildInsert('anime', animeColumns, row));
    }

    lines.push('');
    lines.push('-- ============================================================');
    lines.push('-- watch_history');
    lines.push('-- ============================================================');
    lines.push('');

    for (const row of historyRows) {
      lines.push(buildInsert('watch_history', historyColumns, row));
    }

    if (includeUsers && userRows.length > 0) {
      lines.push('');
      lines.push('-- ============================================================');
      lines.push('-- users');
      lines.push('-- ============================================================');
      lines.push('DELETE FROM `users`;');
      lines.push('');
      for (const row of userRows) {
        lines.push(buildInsert('users', userColumns, row));
      }
    }

    // ---- auto increment reset ----
    lines.push('');
    if (animeRows.length > 0) {
      lines.push(`ALTER TABLE \`anime\` AUTO_INCREMENT = ${Number(animeRows[animeRows.length - 1].id) + 1};`);
    }
    if (historyRows.length > 0) {
      lines.push(`ALTER TABLE \`watch_history\` AUTO_INCREMENT = ${Number(historyRows[historyRows.length - 1].id) + 1};`);
    }
    if (userRows.length > 0) {
      lines.push(`ALTER TABLE \`users\` AUTO_INCREMENT = ${Number(userRows[userRows.length - 1].id) + 1};`);
    }
    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    lines.push('');

    // ---- write file ----
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');

    const rel = path.relative(projectRoot, outputFile);
    console.log(`Backup complete → ${rel}`);
    console.log(`  anime:         ${animeRows.length} rows`);
    console.log(`  watch_history: ${historyRows.length} rows`);
    if (includeUsers) console.log(`  users:         ${userRows.length} rows`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
