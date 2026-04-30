const fs = require('fs');
const path = require('path');
const { config: loadEnv } = require('dotenv');

function resolveProjectRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    return cwd;
  }

  let currentDir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return path.join(__dirname, '../..');
}

const projectRoot = resolveProjectRoot();

let loaded = false;

function loadDatabaseEnv() {
  if (loaded) {
    return;
  }

  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(projectRoot, fileName);
    if (fs.existsSync(filePath)) {
      loadEnv({ path: filePath, override: false });
    }
  }

  loaded = true;
}

function requireEnv(name) {
  loadDatabaseEnv();

  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createDbConfig(overrides = {}) {
  return {
    host: requireEnv('MYSQL_HOST'),
    port: Number(requireEnv('MYSQL_PORT')),
    user: requireEnv('MYSQL_USER'),
    password: requireEnv('MYSQL_PASSWORD'),
    database: requireEnv('MYSQL_DATABASE'),
    charset: 'utf8mb4',
    ...overrides,
  };
}

/**
 * 返回当前 CST (UTC+8) 时间的文件名安全时间戳，格式 "2026-03-31_14-05-00"。
 * 统一替代各脚本里重复的 new Date(Date.now() + 8*3600000).toISOString() 写法。
 */
function nowCSTTimestamp() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(' ', '_').replace(/:/g, '-');
}

/**
 * 返回当前 CST 时间可读字符串，格式 "2026-03-31 14:05:00"（用于注释/日志）。
 */
function nowCSTReadable() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date());
}

module.exports = {
  projectRoot,
  loadDatabaseEnv,
  requireEnv,
  createDbConfig,
  nowCSTTimestamp,
  nowCSTReadable,
};