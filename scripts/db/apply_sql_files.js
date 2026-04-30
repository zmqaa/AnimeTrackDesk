const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv, projectRoot } = require('../shared/db_env');

async function main() {
  loadDatabaseEnv();

  const inputFiles = process.argv.slice(2);
  if (inputFiles.length === 0) {
    throw new Error('Usage: node scripts/db/apply_sql_files.js <file.sql> [more.sql]');
  }

  const connection = await mysql.createConnection(createDbConfig({ multipleStatements: true }));

  try {
    for (const file of inputFiles) {
      const absolutePath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
      const sql = fs.readFileSync(absolutePath, 'utf8');
      const displayPath = path.relative(projectRoot, absolutePath) || absolutePath;

      console.log(`Applying ${displayPath} ...`);
      await connection.query(sql);
      console.log(`Applied ${displayPath}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});