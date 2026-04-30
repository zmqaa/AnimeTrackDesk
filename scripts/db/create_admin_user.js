const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv } = require('../shared/db_env');

async function main() {
  loadDatabaseEnv();

  const [username, password, nameArg] = process.argv.slice(2);
  if (!username || !password) {
    throw new Error('Usage: npm run user:create-admin -- <username> <password> [display_name]');
  }

  const displayName = nameArg || username;
  const passwordHash = await bcrypt.hash(password, 10);
  const connection = await mysql.createConnection(createDbConfig());

  try {
    const [rows] = await connection.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    const existingRows = Array.isArray(rows) ? rows : [];

    if (existingRows.length > 0) {
      await connection.query(
        'UPDATE users SET password_hash = ?, name = ?, role = ? WHERE username = ?',
        [passwordHash, displayName, 'admin', username]
      );
      console.log(`Updated existing user ${username} as admin.`);
      return;
    }

    await connection.query(
      'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)',
      [username, passwordHash, displayName, 'admin']
    );
    console.log(`Created admin user ${username}.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});