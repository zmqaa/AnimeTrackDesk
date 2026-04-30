/**
 * 定时备份脚本 — 配合 cron 使用
 *
 * 导出 anime + watch_history 两张表为 SQL 文件，自动轮转旧备份。
 *
 * 用法：
 *   node scripts/db/scheduled_backup.js              # 默认保留 10 份
 *   node scripts/db/scheduled_backup.js --keep 30    # 保留 30 份
 *   node scripts/db/scheduled_backup.js --keep 5     # 保留 5 份
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const mysqlPromise = require('mysql2/promise');
const { createDbConfig, projectRoot, nowCSTTimestamp, nowCSTReadable } = require('../shared/db_env');

const BACKUP_DIR = path.join(projectRoot, 'backups');
const BACKUP_PREFIX = 'scheduled-backup-';
const DEFAULT_KEEP = 10;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let keep = DEFAULT_KEEP;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keep' && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (n > 0) keep = n;
    }
  }

  return { keep };
}

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
// 轮转：删除超出保留数量的旧文件
// ---------------------------------------------------------------------------

function rotateBackups(keep) {
  if (!fs.existsSync(BACKUP_DIR)) return;

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.sql'))
    .sort();

  if (files.length <= keep) return;

  const toDelete = files.slice(0, files.length - keep);
  for (const f of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`[backup] 删除旧备份: ${f}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { keep } = parseArgs();

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const connection = await mysqlPromise.createConnection(createDbConfig());

  try {
    // ---- 查询数据 ----
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

    const [historyRows] = await connection.query(`
      SELECT
        id, animeId, animeTitle, episode,
        DATE_FORMAT(watchedAt, '%Y-%m-%d %H:%i:%s') AS watchedAt
      FROM watch_history ORDER BY watchedAt ASC, id ASC
    `);

    const historyColumns = ['id', 'animeId', 'animeTitle', 'episode', 'watchedAt'];

    // ---- 构建 SQL ----
    const ts = nowCSTTimestamp();
    const fileName = `${BACKUP_PREFIX}${ts}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);

    const lines = [
      '-- Scheduled backup (scheduled_backup.js)',
      `-- Database: ${process.env.MYSQL_DATABASE}`,
      `-- Generated: ${nowCSTReadable()} (UTC+8)`,
      `-- Tables: anime (${animeRows.length}), watch_history (${historyRows.length})`,
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

    // ---- auto increment ----
    lines.push('');
    if (animeRows.length > 0) {
      lines.push(`ALTER TABLE \`anime\` AUTO_INCREMENT = ${Number(animeRows[animeRows.length - 1].id) + 1};`);
    }
    if (historyRows.length > 0) {
      lines.push(`ALTER TABLE \`watch_history\` AUTO_INCREMENT = ${Number(historyRows[historyRows.length - 1].id) + 1};`);
    }
    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    lines.push('');

    // ---- 写文件 ----
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`[backup] 备份完成: ${fileName}`);
    console.log(`[backup] anime: ${animeRows.length} 条, watch_history: ${historyRows.length} 条`);

    // ---- 轮转 ----
    rotateBackups(keep);
    console.log(`[backup] 保留策略: 最近 ${keep} 份`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('[backup] 备份失败:', err.message);
  process.exit(1);
});
