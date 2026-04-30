/**
 * enrich_titles.js — 用 AI 批量标准化动画标题
 *
 * 单次 AI 调用，直接返回标准中文名和原始标题。
 *
 * Usage:
 *   node scripts/enrich/enrich_titles.js [options]
 *
 * Options:
 *   --write             实际写入数据库（默认 dry-run）
 *   --force             处理所有记录，不仅限于 original_title 为空的记录
 *   --no-update-title   不覆盖 title，只补 original_title
 *   --limit=N           最多处理 N 条
 *   --ids=1,2,3         只处理指定 ID
 *   --concurrency=3     并发数（默认 3，最大 5）
 *   --min-confidence=70 最低置信度（默认 70，范围 0-100）
 *   --help              显示帮助
 */

const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv } = require('../shared/db_env');
const { isSeasonCompatible } = require('../shared/query_hint_ai');

loadDatabaseEnv();

const DEFAULT_AI_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_AI_MODEL = 'deepseek-chat';
const FETCH_TIMEOUT_MS = 30000;
const MAX_CONCURRENCY = 5;

function normalizeAiApiUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return DEFAULT_AI_URL;
  }

  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  if (/ark\.cn-[^.]+\.volces\.com\/api\/v\d+$/i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}/chat/completions`;
  }

  return withoutTrailingSlash;
}

function shouldUseJsonFormat(apiUrl, model) {
  const override = String(process.env.AI_JSON_FORMAT ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(override)) {
    return false;
  }

  if (['true', '1', 'on', 'yes'].includes(override)) {
    return true;
  }

  if (String(apiUrl || '').includes('.volces.com') || String(model || '').toLowerCase().startsWith('ep-')) {
    return false;
  }

  return true;
}

function getAiConfig() {
  return {
    apiUrl: normalizeAiApiUrl(process.env.AI_API_URL),
    model: String(process.env.AI_MODEL || '').trim() || DEFAULT_AI_MODEL,
    apiKey: String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim(),
  };
}

function shouldDisableThinking(aiConfig) {
  if (String(process.env.AI_DISABLE_THINKING || '').trim().toLowerCase() === 'false') {
    return false;
  }
  return aiConfig.apiUrl.includes('dashscope.aliyuncs.com') || aiConfig.model.startsWith('qwen');
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    force: false,
    updateTitle: true,
    limit: undefined,
    ids: undefined,
    concurrency: 3,
    minConfidence: 70,
  };

  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { options.dryRun = false; continue; }
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--no-update-title') { options.updateTitle = false; continue; }
    if (arg.startsWith('--limit=')) {
      const v = Number(arg.slice(8));
      if (v > 0) options.limit = v;
      continue;
    }
    if (arg.startsWith('--ids=')) {
      options.ids = arg.slice(6).split(',').map(Number).filter((id) => id > 0);
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      const v = Number(arg.slice(14));
      if (v > 0) options.concurrency = Math.min(v, MAX_CONCURRENCY);
      continue;
    }
    if (arg.startsWith('--min-confidence=')) {
      const v = Number(arg.slice(17));
      if (Number.isFinite(v)) options.minConfidence = Math.max(0, Math.min(100, v));
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/enrich/enrich_titles.js [options]
  --write             写入数据库（默认 dry-run）
  --force             强制刷新已有 original_title 的记录
  --no-update-title   不覆盖中文标题
  --limit=N           最多处理 N 条
  --ids=1,2,3         只处理指定 ID
  --concurrency=3     AI 并发数（默认 3，上限 5）
  --min-confidence=70 最低置信度（默认 70）`);
}

function sanitizeTitle(value) {
  return (typeof value === 'string' ? value.trim() : '').replace(/\s+/g, ' ').slice(0, 500);
}

function hasExplicitSeasonHint(value) {
  return /第\s*[一二三四五六七八九十0-9两]+\s*(?:季|期)|season\s*[0-9]+|[0-9]+(?:st|nd|rd|th)\s+season|\bs[0-9]+\b|剧场版|ova|oad|sp/i.test(String(value || ''));
}

function extractSeasonNumber(value) {
  const text = String(value || '');
  const match = text.match(/第([一二三四五六七八九十0-9两]+)(?:季|期)|season\s*([0-9]+)|s([0-9]+)|([0-9]+)(?:st|nd|rd|th)\s+season/i);
  if (!match) return null;

  if (match[2]) return Number(match[2]);
  if (match[3]) return Number(match[3]);
  if (match[4]) return Number(match[4]);
  if (match[1]) {
    const token = match[1].trim();
    if (/^[0-9]+$/.test(token)) return Number(token);
    const map = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (token === '十') return 10;
    if (token.startsWith('十')) return 10 + (map[token.slice(1)] || 0);
    if (token.endsWith('十')) return (map[token.slice(0, -1)] || 0) * 10;
    if (token.includes('十')) {
      const [h, t] = token.split('十');
      return (map[h] || 0) * 10 + (map[t] || 0);
    }
    return map[token] || null;
  }
  return null;
}

function stripSeasonTokens(value) {
  return String(value || '')
    .replace(/第\s*[一二三四五六七八九十0-9两]+\s*(?:季|期)/gi, ' ')
    .replace(/season\s*[0-9]+/gi, ' ')
    .replace(/\bs[0-9]+\b/gi, ' ')
    .replace(/[0-9]+(?:st|nd|rd|th)\s+season/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForCompare(value) {
  return sanitizeTitle(value)
    .toLowerCase()
    .replace(/[\s·・:：'"""''!！?？,，.。/／\\()（）\[\]【】{}-]+/g, '');
}

function wouldCollapseEdition(inputTitle, nextTitle) {
  const input = sanitizeTitle(inputTitle);
  const next = sanitizeTitle(nextTitle);
  if (!input || !next || !hasExplicitSeasonHint(input)) return false;

  const inputSeason = extractSeasonNumber(input);
  const nextSeason = extractSeasonNumber(next);
  const inputBase = normalizeForCompare(stripSeasonTokens(input));
  const nextBase = normalizeForCompare(stripSeasonTokens(next));

  if (!inputBase || !nextBase || inputBase !== nextBase) return false;
  if (inputSeason && !nextSeason) return true;
  if (inputSeason && nextSeason && inputSeason !== nextSeason) return true;
  return false;
}

async function requestAiJson(aiConfig, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const requestBody = {
    model: aiConfig.model,
    messages,
    temperature: 0.1,
    ...(shouldUseJsonFormat(aiConfig.apiUrl, aiConfig.model) ? { response_format: { type: 'json_object' } } : {}),
    ...(shouldDisableThinking(aiConfig) ? { enable_thinking: false } : {}),
  };

  try {
    const response = await fetch(aiConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`AI ${response.status}: ${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } finally {
    clearTimeout(timer);
  }
}

function buildMessages(inputTitle) {
  return [
    {
      role: 'system',
      content: '你是动画标题标准化助手。识别用户输入对应的具体动画条目，返回标准中文名和原始标题。只输出 JSON。',
    },
    {
      role: 'user',
      content: `请识别下面这条输入对应的具体动画条目，返回标准标题。

输入：${inputTitle}

返回 JSON：
{
  "officialTitle": "标准简体中文名",
  "originalTitle": "原始标题（日文优先，其次英文）",
  "confidence": 0
}

规则：
1. 必须识别到具体作品，不能把续作、剧场版、OVA 退化成母系列名。
2. officialTitle 用通行的标准简体中文名；没把握就留空字符串。
3. originalTitle 必须与 officialTitle 指向同一作品；没把握就留空字符串。
4. 输入含季数、剧场版、OVA、SP 等线索时必须保留在结果中。
5. confidence 取 0-100 整数，低把握宁可低分。`,
    },
  ];
}

async function resolveTitleWithAi(inputTitle, aiConfig) {
  const result = await requestAiJson(aiConfig, buildMessages(inputTitle));
  if (!result) return null;

  const confidence = Number(result.confidence);
  return {
    officialTitle: sanitizeTitle(result.officialTitle),
    originalTitle: sanitizeTitle(result.originalTitle),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 0,
  };
}

function shouldAcceptResult(inputTitle, result, minConfidence) {
  if (!result) return { ok: false, reason: 'no_result' };
  if (result.confidence < minConfidence) return { ok: false, reason: 'low_confidence' };
  if (!result.officialTitle && !result.originalTitle) return { ok: false, reason: 'empty_result' };
  if (!isSeasonCompatible(inputTitle, [result.officialTitle, result.originalTitle])) return { ok: false, reason: 'season_mismatch' };
  if (wouldCollapseEdition(inputTitle, result.officialTitle)) return { ok: false, reason: 'collapsed_edition' };
  return { ok: true, reason: 'accepted' };
}

function formatRejectReason(reason, result) {
  const mapping = {
    no_result: 'AI 无返回',
    low_confidence: `置信度过低 (${result?.confidence ?? 0})`,
    empty_result: '标题结果为空',
    season_mismatch: '季别不一致',
    collapsed_edition: '把明确季别/特别篇退化成母标题',
  };
  return mapping[reason] || reason;
}

async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const aiConfig = getAiConfig();

  if (!aiConfig.apiKey) {
    throw new Error('需要 AI_API_KEY 或 DEEPSEEK_API_KEY');
  }

  const connection = await mysql.createConnection(createDbConfig());

  console.log('\n🎬 动画标题标准化');
  console.log(`AI: ${aiConfig.apiUrl} | model: ${aiConfig.model}`);
  console.log(`模式: ${options.dryRun ? 'DRY-RUN' : 'WRITE'} | concurrency=${options.concurrency} | minConfidence=${options.minConfidence} | updateTitle=${options.updateTitle}\n`);

  const stats = { updatedTitle: 0, updatedOriginal: 0, updatedBoth: 0, skipped: 0, rejected: 0, errors: 0 };

  try {
    const [rows] = await connection.execute('SELECT id, title, original_title AS originalTitle FROM anime ORDER BY id ASC');
    const allRows = Array.isArray(rows) ? rows : [];

    let candidates = options.ids ? allRows.filter((row) => options.ids.includes(row.id)) : allRows;
    if (!options.force) {
      const before = candidates.length;
      candidates = candidates.filter((row) => !sanitizeTitle(row.originalTitle));
      console.log(`共 ${allRows.length} 条，缺少原名 ${candidates.length} 条（已有 ${before - candidates.length} 条跳过）`);
    } else {
      console.log(`共 ${allRows.length} 条，强制处理全部`);
    }

    if (options.limit) candidates = candidates.slice(0, options.limit);

    console.log(`本次处理: ${candidates.length} 条\n`);
    if (candidates.length === 0) {
      console.log('没有需要处理的记录。');
      return;
    }

    const tasks = candidates.map((row, index) => async () => {
      const currentTitle = sanitizeTitle(row.title);
      const currentOriginal = sanitizeTitle(row.originalTitle);
      const label = `[${index + 1}/${candidates.length}] #${row.id}`;

      try {
        const result = await resolveTitleWithAi(currentTitle, aiConfig);
        const decision = shouldAcceptResult(currentTitle, result, options.minConfidence);
        if (!decision.ok) {
          stats.rejected++;
          console.log(`  ${label} "${currentTitle}" → 跳过: ${formatRejectReason(decision.reason, result)}`);
          return;
        }

        const nextOfficial = sanitizeTitle(result.officialTitle);
        const nextOriginal = sanitizeTitle(result.originalTitle);

        const titleChanged = Boolean(options.updateTitle && nextOfficial && nextOfficial !== currentTitle);
        const originalChanged = Boolean(nextOriginal && nextOriginal !== currentOriginal);

        if (!titleChanged && !originalChanged) {
          stats.skipped++;
          console.log(`  ${label} "${currentTitle}" = 无变化 (confidence=${result.confidence})`);
          return;
        }

        const updates = {};
        const parts = [];
        if (titleChanged) { updates.title = nextOfficial; parts.push(`中文名: "${currentTitle}" → "${nextOfficial}"`); }
        if (originalChanged) { updates.original_title = nextOriginal; parts.push(`原名: "${currentOriginal || '(空)'}" → "${nextOriginal}"`); }

        console.log(`  ${label} "${currentTitle}" ✓ ${options.dryRun ? '[dry-run]' : '[写入]'} [confidence=${result.confidence}] ${parts.join(' | ')}`);

        if (!options.dryRun) {
          const columns = Object.keys(updates).map((key) => `${key} = ?`);
          columns.push('updatedAt = NOW()');
          await connection.execute(`UPDATE anime SET ${columns.join(', ')} WHERE id = ?`, [...Object.values(updates), row.id]);
        }

        if (titleChanged && originalChanged) stats.updatedBoth++;
        else if (titleChanged) stats.updatedTitle++;
        else stats.updatedOriginal++;
      } catch (error) {
        stats.errors++;
        console.error(`  ${label} ✗ 错误: ${error?.message || error}`);
      }
    });

    await runConcurrent(tasks, options.concurrency);

    const totalChanged = stats.updatedTitle + stats.updatedOriginal + stats.updatedBoth;
    console.log(`\n${'─'.repeat(56)}`);
    console.log(`完成: 变更=${totalChanged} (仅中文名=${stats.updatedTitle}, 仅原名=${stats.updatedOriginal}, 两者=${stats.updatedBoth})`);
    console.log(`      无变化=${stats.skipped}, 拒绝写入=${stats.rejected}, 错误=${stats.errors}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
