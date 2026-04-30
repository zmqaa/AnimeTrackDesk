/**
 * enrich_bangumi.js — 用 original_title 精确查询 Bangumi，补充元数据
 *
 * 完全独立，不依赖 lib/ 内部模块。直接调用 Bangumi v0 API。
 *
 * 核心策略：
 *   1. 优先用 original_title（日文标题）精确匹配 Bangumi — 准确率极高
 *   2. 若无 original_title 或未匹配，回退到 title 模糊搜索
 *   3. 用 subject detail API 补充全部字段
 *   4. 用 episodes API 补充 durationMinutes
 *
 * 补充字段: score, totalEpisodes, durationMinutes, summary, tags, coverUrl, isFinished
 *
 * Usage:
 *   node scripts/enrich/enrich_bangumi.js [options]
 *
 * Options:
 *   --write           写入数据库（默认 dry-run 只输出预览）
 *   --force           强制覆盖已有字段
 *   --ids=1,2,3       只处理指定 ID
 *   --limit=N         最多处理 N 条
 *   --concurrency=N   并发数（默认 2，建议不超过 3，避免触发 Bangumi 限速）
 *   --help            显示帮助
 */

'use strict';

const mysql = require('mysql2/promise');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env.local') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ─── Bangumi API ────────────────────────────────────────────────────────────

const USER_AGENT = 'AnimeTrack/1.0 (personal tracker)';
const FETCH_TIMEOUT_MS = 10000;
const API_DELAY_MS = 350; // Bangumi 限速：每个请求间隔

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从多个同名候选中选出最匹配的 subject。
 *
 * 消歧优先级：
 *   1. progress（用户实际看了几集）→ 选话数（eps）最接近的版本，最可靠
 *   2. premiere_date → 次选日期最近的（当 progress=0 或无从判断话数时）
 *   3. 都无法判断 → 返回第一个
 *
 * 这样可以避免用「可能本身就是错的 premiere_date」来消歧，
 * 同时利用用户真实观看集数（progress）作为最强信号。
 */
function pickBestSubject(subjects, anime) {
  if (subjects.length === 1) return subjects[0];

  // 信号 1：progress（实际观看集数）
  const progress = Number(anime.progress) || 0;
  if (progress > 0) {
    // 选 eps 与 progress 差距最小的版本
    let best = subjects[0];
    let bestDiff = Infinity;
    for (const s of subjects) {
      const eps = Number(s.eps) || 0;
      if (eps <= 0) continue;
      const diff = Math.abs(eps - progress);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    // 如果找到明确更优的（eps 精确匹配或更接近），优先用
    if (bestDiff < Infinity) return best;
  }

  // 信号 2：premiere_date（作为备用，可能有错，仅次选）
  const premiereDate = anime.premiere_date || null;
  if (premiereDate) {
    const ref = new Date(premiereDate).getTime();
    if (!isNaN(ref)) {
      let best = subjects[0];
      let bestDiff = Infinity;
      for (const s of subjects) {
        if (!s.date) continue;
        const diff = Math.abs(new Date(s.date).getTime() - ref);
        if (diff < bestDiff) { bestDiff = diff; best = s; }
      }
      return best;
    }
  }

  return subjects[0];
}

/**
 * 精确搜索：用 original_title 搜索，收集所有 name 完全匹配的结果，
 * 再用 pickBestSubject 消歧（优先 progress，次选 premiere_date）。
 */
async function searchBangumiExact(originalTitle, anime) {
  try {
    const res = await fetchWithTimeout('https://api.bgm.tv/v0/search/subjects?limit=10', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: originalTitle,
        filter: { type: [2] }, // type=2: 动画
        sort: 'match',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.length) return null;

    // 收集所有 name 精确匹配的结果
    const exactAll = data.data.filter(s => s.name === originalTitle);
    if (exactAll.length > 0) return pickBestSubject(exactAll, anime);

    // 次选：name 包含 originalTitle（季度后缀稍有差异）
    const partialAll = data.data.filter(s =>
      s.name?.includes(originalTitle) || originalTitle.includes(s.name || '')
    );
    if (partialAll.length > 0) return pickBestSubject(partialAll, anime);

    return null;
  } catch {
    return null;
  }
}

/**
 * 模糊搜索：用中文 title 搜，同样用 pickBestSubject 消歧。
 * 置信度较低，会在输出中标注 FALLBACK。
 */
async function searchBangumiByTitle(title, anime) {
  try {
    const res = await fetchWithTimeout('https://api.bgm.tv/v0/search/subjects?limit=10', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: title,
        filter: { type: [2] },
        sort: 'match',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.length) return null;
    // 先尝试找 name_cn 匹配中文标题的
    const cnMatch = data.data.filter(s => s.name_cn === title);
    if (cnMatch.length > 0) return pickBestSubject(cnMatch, anime);
    return pickBestSubject(data.data, anime);
  } catch {
    return null;
  }
}

/**
 * 获取 subject 详情（分数、话数、简介、tags、封面等）
 */
async function fetchSubjectDetail(subjectId) {
  try {
    await sleep(API_DELAY_MS);
    const res = await fetchWithTimeout(`https://api.bgm.tv/v0/subjects/${subjectId}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * 获取第一集时长（秒 → 分钟）
 */
async function fetchEpisodeDuration(subjectId) {
  try {
    await sleep(API_DELAY_MS);
    const res = await fetchWithTimeout(
      `https://api.bgm.tv/v0/episodes?subject_id=${subjectId}&type=0&limit=5`,
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // 找第一个有时长的普通集
    for (const ep of (data?.data || [])) {
      if (ep.duration_seconds && ep.duration_seconds > 0) {
        return Math.round(ep.duration_seconds / 60);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 数据提取 ───────────────────────────────────────────────────────────────

function extractScore(detail) {
  const s = detail?.rating?.score;
  if (!s || s <= 0) return null;
  return Math.round(s * 10) / 10; // 保留一位小数
}

function extractTotalEpisodes(detail) {
  // eps 字段是话数
  const ep = detail?.eps;
  if (ep && ep > 0) return ep;
  // infobox 里的"话数"
  if (Array.isArray(detail?.infobox)) {
    const entry = detail.infobox.find(i => i.key === '话数' || i.key === '集数');
    if (entry?.value) {
      const n = parseInt(String(entry.value), 10);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

function extractSummary(detail) {
  return detail?.summary?.trim() || null;
}

function extractTags(detail) {
  if (!Array.isArray(detail?.tags) || detail.tags.length === 0) return null;
  const tags = detail.tags
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 12)
    .map(t => t.name)
    .filter(Boolean);
  return tags.length ? tags : null;
}

function extractCoverUrl(detail) {
  return detail?.images?.large || detail?.images?.common || detail?.images?.medium || null;
}

/**
 * 判断是否已完结：播放结束日期早于今天。
 * 返回 1（完结）、0（未完结）或 null（无法判断）。
 */
function extractIsFinished(detail) {
  if (!Array.isArray(detail?.infobox)) return null;
  const endEntry = detail.infobox.find(i => i.key === '播放结束' || i.key === '放送结束');
  if (!endEntry?.value) return null;
  const dateStr = String(endEntry.value).replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, '$1-$2-$3');
  const endDate = new Date(dateStr);
  if (isNaN(endDate.getTime())) return null;
  return endDate < new Date() ? 1 : 0;
}

/**
 * 提取开播日期：直接用 subject 的 date 字段（即 Bangumi 搜索结果里就有，不需要 detail）。
 * detail 里的 date 同理，优先用 detail.date（更权威）。
 */
function extractPremiereDate(subject, detail) {
  const raw = detail?.date || subject?.date;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dryRun: true, force: false, ids: null, limit: null, concurrency: 2 };
  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { opts.dryRun = false; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg.startsWith('--ids=')) {
      opts.ids = arg.slice(6).split(',').map(Number).filter(n => n > 0);
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice(8));
      if (n > 0) opts.limit = n;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice(14));
      if (n > 0) opts.concurrency = Math.min(n, 4);
      continue;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Usage: node scripts/enrich/enrich_bangumi.js [options]

  --write           写入数据库（默认 dry-run）
  --force           强制覆盖已有字段（默认跳过已填字段）
  --ids=1,2,3       只处理指定 ID
  --limit=N         最多处理 N 条
  --concurrency=N   并发数（默认 2，建议不超过 3）
  --help            显示帮助

字段说明:
  补充: score, totalEpisodes, durationMinutes, summary, tags, coverUrl, isFinished, premiereDate
  保留: title, original_title, notes, cast, cast_aliases, status, progress
`);
}

/**
 * 处理单条 anime 记录，返回 patch 对象（只包含需要更新的字段）。
 */
async function processAnime(anime, opts) {
  const label = `[${String(anime.id).padStart(3)}] ${anime.title}`;

  // 判断哪些字段需要填充
  const needsUpdate = field => {
    if (opts.force) return true;
    const val = anime[field];
    if (val === null || val === undefined || val === '') return true;
    if (field === 'tags') {
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        return !Array.isArray(parsed) || parsed.length === 0;
      } catch { return true; }
    }
    return false;
  };

  const fieldsNeeded = ['score', 'totalEpisodes', 'durationMinutes', 'summary', 'tags', 'coverUrl', 'isFinished', 'premiereDate']
    .filter(needsUpdate);

  if (fieldsNeeded.length === 0) {
    return { label, skip: true, reason: '所有字段已填充' };
  }

  // ── Step 1: 搜索 Bangumi ──
  await sleep(API_DELAY_MS);
  let subject = null;
  let matchMethod = '';

  if (anime.original_title) {
    subject = await searchBangumiExact(anime.original_title, anime);
    if (subject) matchMethod = 'original_title精确';
  }

  if (!subject) {
    subject = await searchBangumiByTitle(anime.title, anime);
    matchMethod = subject ? 'title回退' : '';
  }

  if (!subject) {
    return { label, skip: true, reason: '未找到 Bangumi 结果' };
  }

  const subjectId = subject.id;

  // ── Step 2: 获取详情 ──
  const detail = await fetchSubjectDetail(subjectId);
  if (!detail) {
    return { label, skip: true, reason: `subject ${subjectId} 详情获取失败` };
  }

  // ── Step 3: 获取集数时长 ──
  let durationMinutes = null;
  if (fieldsNeeded.includes('durationMinutes')) {
    durationMinutes = await fetchEpisodeDuration(subjectId);
    // 如果 episodes API 没有，尝试从 infobox 读取
    if (!durationMinutes && Array.isArray(detail?.infobox)) {
      const durEntry = detail.infobox.find(i => i.key === '每话时长' || i.key === '每集时长' || i.key === '时长');
      if (durEntry?.value) {
        const m = String(durEntry.value).match(/(\d+)/);
        if (m) durationMinutes = parseInt(m[1], 10);
      }
    }
  }

  // ── Step 4: 组装 patch ──
  const patch = {};
  const extracted = {
    score:          extractScore(detail),
    totalEpisodes:  extractTotalEpisodes(detail),
    durationMinutes,
    summary:        extractSummary(detail),
    tags:           extractTags(detail),
    coverUrl:       extractCoverUrl(detail),
    isFinished:     extractIsFinished(detail),
    premiereDate:   extractPremiereDate(subject, detail),
  };

  for (const field of fieldsNeeded) {
    if (extracted[field] !== null && extracted[field] !== undefined) {
      patch[field] = extracted[field];
    }
  }

  return {
    label,
    skip: false,
    matchMethod,
    bangumiId: subjectId,
    bangumiName: detail.name,
    patch,
    missing: fieldsNeeded.filter(f => patch[f] === undefined),
  };
}

/**
 * 并发池：按 concurrency 限制并发处理任务。
 */
async function runPool(items, concurrency, fn) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── 数据库操作 ──────────────────────────────────────────────────────────────

function buildDbConfig() {
  return {
    host:     process.env.MYSQL_HOST || 'localhost',
    port:     Number(process.env.MYSQL_PORT) || 3306,
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

async function applyPatch(conn, animeId, patch) {
  const setClauses = [];
  const values = [];

  for (const [field, value] of Object.entries(patch)) {
    const col = fieldToColumn(field);
    if (col === null) continue;
    setClauses.push(`${col} = ?`);
    values.push(Array.isArray(value) ? JSON.stringify(value) : value);
  }

  if (setClauses.length === 0) return;
  setClauses.push('updatedAt = NOW()');
  values.push(animeId);

  await conn.execute(
    `UPDATE anime SET ${setClauses.join(', ')} WHERE id = ?`,
    values
  );
}

function fieldToColumn(field) {
  const map = {
    score:           'score',
    totalEpisodes:   'totalEpisodes',
    durationMinutes: 'durationMinutes',
    summary:         'summary',
    tags:            'tags',
    coverUrl:        'coverUrl',
    isFinished:      'isFinished',
    premiereDate:    'premiere_date',
  };
  return map[field] ?? null;
}

// ─── 输出格式化 ──────────────────────────────────────────────────────────────

function formatPatchPreview(patch) {
  const lines = [];
  for (const [k, v] of Object.entries(patch)) {
    let display = v;
    if (k === 'tags' && Array.isArray(v)) display = v.join(', ');
    if (k === 'summary' && typeof v === 'string') display = v.slice(0, 60) + (v.length > 60 ? '…' : '');
    if (k === 'coverUrl' && typeof v === 'string') display = v.slice(0, 60) + '…';
    lines.push(`    ${k}: ${display}`);
  }
  return lines.join('\n');
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('\n=== enrich_bangumi.js ===');
  console.log(`模式: ${opts.dryRun ? 'DRY-RUN（不写库）' : '✅ WRITE（写入数据库）'}`);
  if (opts.force) console.log('  --force: 强制覆盖已有字段');
  console.log();

  const conn = await mysql.createConnection(buildDbConfig());

  try {
    // 查询需要处理的记录
    let query = 'SELECT id, title, original_title, premiere_date, progress, score, totalEpisodes, durationMinutes, summary, tags, coverUrl, isFinished FROM anime';
    const conditions = [];
    const params = [];

    if (opts.ids?.length) {
      conditions.push(`id IN (${opts.ids.map(() => '?').join(',')})`);
      params.push(...opts.ids);
    }

    if (!opts.force) {
      // 只取至少有一个字段为空的记录
      conditions.push(`(
        score IS NULL OR totalEpisodes IS NULL OR durationMinutes IS NULL
        OR summary IS NULL OR summary = ''
        OR tags IS NULL OR JSON_LENGTH(tags) = 0
        OR coverUrl IS NULL OR isFinished IS NULL
        OR premiere_date IS NULL
      )`);
    }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY id';
    if (opts.limit) query += ` LIMIT ${opts.limit}`;

    const [rows] = await conn.query(query, params);
    console.log(`待处理: ${rows.length} 条记录\n`);

    if (rows.length === 0) {
      console.log('没有需要处理的记录。');
      return;
    }

    // 并发处理
    const results = await runPool(rows, opts.concurrency, (anime) => processAnime(anime, opts));

    // 统计
    let updated = 0, skipped = 0, failed = 0;
    const patches = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const anime = rows[i];

      if (r.skip) {
        console.log(`⏭  ${r.label} — ${r.reason}`);
        skipped++;
        continue;
      }

      const patchCount = Object.keys(r.patch).length;
      if (patchCount === 0) {
        console.log(`⚠  ${r.label} — Bangumi 无有效数据 (${r.matchMethod}, id=${r.bangumiId})`);
        failed++;
        continue;
      }

      const confidenceTag = r.matchMethod === 'original_title精确' ? '✅' : '⚠️ FALLBACK';
      console.log(`${confidenceTag} ${r.label}`);
      console.log(`   Bangumi: [${r.bangumiId}] ${r.bangumiName} (${r.matchMethod})`);
      console.log(formatPatchPreview(r.patch));
      if (r.missing?.length) {
        console.log(`   ⚠ 未获取: ${r.missing.join(', ')}`);
      }
      console.log();

      patches.push({ id: anime.id, patch: r.patch });
      updated++;
    }

    console.log('\n─────────────────────────────────────────');
    console.log(`总计: ${rows.length} 条 | 可更新: ${updated} | 跳过: ${skipped} | 无数据: ${failed}`);

    // 写库
    if (!opts.dryRun && patches.length > 0) {
      console.log('\n写入数据库...');
      for (const { id, patch } of patches) {
        await applyPatch(conn, id, patch);
      }
      console.log(`✅ 已写入 ${patches.length} 条`);
    } else if (opts.dryRun && patches.length > 0) {
      console.log('\n提示: 加 --write 参数执行写入。');
    }

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
