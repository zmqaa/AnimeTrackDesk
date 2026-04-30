const DEFAULT_AI_URL = 'https://api.deepseek.com/chat/completions';

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

const AI_API_URL = normalizeAiApiUrl(process.env.AI_API_URL);
const AI_MODEL = String(process.env.AI_MODEL || '').trim() || 'deepseek-chat';
const FETCH_TIMEOUT_MS = 20000;

function getAiQueryHintApiKey() {
  return String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function parseChineseSeasonNumber(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  if (/^[0-9]+$/.test(normalized)) return Number(normalized);

  const map = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  };

  if (normalized === '十') return 10;
  if (normalized.startsWith('十')) {
    const tail = normalized.slice(1);
    return 10 + (map[tail] || 0);
  }
  if (normalized.endsWith('十')) {
    const head = normalized.slice(0, -1);
    return (map[head] || 0) * 10;
  }
  if (normalized.includes('十')) {
    const [head, tail] = normalized.split('十');
    return (map[head] || 0) * 10 + (map[tail] || 0);
  }
  return map[normalized] || null;
}

function parseJapaneseSeasonNumber(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized) return null;
  const map = {
    'いち': 1, 'に': 2, 'さん': 3, 'よん': 4, 'し': 4, 'ご': 5,
    'ろく': 6, 'なな': 7, 'しち': 7, 'はち': 8, 'きゅう': 9, 'く': 9,
    'じゅう': 10,
  };
  return map[normalized] || null;
}

function parseCircledSeasonNumber(token) {
  const normalized = String(token || '').trim();
  const map = {
    '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
    '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
  };
  return map[normalized] || null;
}

function parseBangumiNumericSuffixSeason(value) {
  const match = String(value || '').trim().match(/。\s*([0-9]{1,2})$/);
  if (!match) return null;

  const season = Number(match[1]);
  return Number.isFinite(season) && season > 0 ? season : null;
}

function extractSeasonNumber(value) {
  const text = String(value || '');
  const match = text.match(/第([一二三四五六七八九十0-9两]+)(?:季|期)|season\s*([0-9]+)|s([0-9]+)|([0-9]+)(?:st|nd|rd|th)\s+season|([0-9]+)丁目|その([ぁ-ん]+)|([①②③④⑤⑥⑦⑧⑨⑩])/i);
  if (!match) {
    return parseBangumiNumericSuffixSeason(text);
  }

  return parseChineseSeasonNumber(match[1])
    || Number(match[2])
    || Number(match[3])
    || Number(match[4])
    || Number(match[5])
    || parseJapaneseSeasonNumber(match[6])
    || parseCircledSeasonNumber(match[7])
    || parseBangumiNumericSuffixSeason(text)
    || null;
}

function isSeasonCompatible(inputTitle, candidateTitles) {
  const inputSeason = extractSeasonNumber(inputTitle);
  if (!inputSeason) {
    return true;
  }

  const candidates = Array.isArray(candidateTitles) ? candidateTitles : [candidateTitles];
  const candidateSeasons = candidates.map((value) => extractSeasonNumber(value)).filter((value) => value != null);

  if (inputSeason === 1) {
    return candidateSeasons.length === 0 || candidateSeasons.includes(1);
  }

  return candidateSeasons.includes(inputSeason);
}

function mergeHintQueries(baseQueries, hints) {
  if (!hints) {
    return uniqueStrings(baseQueries);
  }

  return uniqueStrings([
    ...(Array.isArray(baseQueries) ? baseQueries : []),
    hints.normalizedTitle,
    hints.originalTitle,
    ...(Array.isArray(hints.aliases) ? hints.aliases : []),
  ]);
}

async function fetchAiTitleQueryHints(title, apiKey) {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle || !apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是动漫标题检索助手。你的任务不是编造元数据，而是把用户输入整理成更适合动漫数据库搜索的候选查询。只输出 JSON，不输出解释。',
          },
          {
            role: 'user',
            content: `请根据下面这条用户输入的动画名称或自然语言描述，返回更适合 Bangumi 搜索的候选查询。\n\n用户输入：${normalizedTitle}\n\n返回 JSON：\n{\n  "normalizedTitle": "标准中文标题或最接近的具体动画条目名，不确定可空字符串",\n  "originalTitle": "日文或英文原名，不确定可空字符串",\n  "aliases": ["可用于搜索的别名1", "别名2"],\n  "confidence": 0.0\n}\n\n规则：\n1. 不要编造不存在的季数、剧场版或副标题。\n2. 如果用户输入像“第一季/第二季/第三季”，只有在你能高把握确认该具体动画条目存在时，才保留该季标题；否则宁可返回更基础、更安全的系列动画条目名。\n3. originalTitle 优先返回日文官方标题；如果更适合搜索，也可以返回稳定英文标题。\n4. aliases 只放对搜索有帮助的同义标题，不要塞描述性句子。\n5. 如果把握一般，confidence 降低；低于 0.55 的结果调用方会忽略。`,
          },
        ],
        temperature: 0.1,
        ...(shouldUseJsonFormat(AI_API_URL, AI_MODEL) ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return null;
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const payload = JSON.parse(jsonMatch[0]);
    const confidence = Number(payload?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.55) {
      return null;
    }

    return {
      normalizedTitle: typeof payload?.normalizedTitle === 'string' ? payload.normalizedTitle.trim() : '',
      originalTitle: typeof payload?.originalTitle === 'string' ? payload.originalTitle.trim() : '',
      aliases: Array.isArray(payload?.aliases)
        ? payload.aliases.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
        : [],
      confidence,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  getAiQueryHintApiKey,
  fetchAiTitleQueryHints,
  mergeHintQueries,
  uniqueStrings,
  extractSeasonNumber,
  isSeasonCompatible,
};