/**
 * 中文数字解析与季数提取工具
 * 从 anime.ts 和 ai.ts 中抽取的公共逻辑
 */

const CJK_DIGIT_MAP: Record<string, number> = {
  '零': 0, '〇': 0,
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

/**
 * 把中文数字 token（如 "三"、"十二"、"二十三"）解析为正整数，
 * 也兼容阿拉伯数字字符串。
 * 解析失败或 ≤ 0 时返回 undefined。
 */
export function parseChineseNumberToken(token: string): number | undefined {
  const normalized = token.trim();
  if (!normalized) return undefined;

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  let value = 0;
  let current = 0;

  for (const char of normalized) {
    if (CJK_DIGIT_MAP[char] !== undefined) {
      current = CJK_DIGIT_MAP[char];
      continue;
    }
    if (char === '十') { value += (current || 1) * 10; current = 0; continue; }
    if (char === '百') { value += (current || 1) * 100; current = 0; continue; }
    return undefined;
  }

  value += current;
  return value > 0 ? value : undefined;
}

/**
 * 把正整数转为简短中文 token（1→一，12→十二，23→二十三）。
 * 仅处理 1–99，超出范围回退为阿拉伯数字字符串。
 */
export function toChineseNumberToken(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return String(value);

  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return digits[value];
  if (value < 20) return `十${value % 10 === 0 ? '' : digits[value % 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones === 0 ? '' : digits[ones]}`;
  }
  return String(value);
}

/** 季数/期数正则 */
const SEASON_ZH_RE = /第\s*([0-9一二三四五六七八九十百零两〇]+)\s*[季期]/i;
const SEASON_EN_RE = /\bseason\s*([0-9]{1,3})\b/i;
const SEASON_S_RE  = /\bS\s*([0-9]{1,3})\b/i;

/** 从文本中提取季数（如 "第二季" → 2） */
export function extractSeasonNumber(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const normalized = text.trim();
  if (!normalized) return undefined;

  const zhToken = normalized.match(SEASON_ZH_RE)?.[1];
  if (zhToken) return parseChineseNumberToken(zhToken);

  const seasonToken = normalized.match(SEASON_EN_RE)?.[1];
  if (seasonToken) return Number(seasonToken);

  const sToken = normalized.match(SEASON_S_RE)?.[1];
  if (sToken) return Number(sToken);

  return undefined;
}

/** 去除标题中的季数标记，返回"基础标题" */
export function stripSeasonToken(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*[季期]/gi, ' ')
    .replace(/\bseason\s*[0-9]{1,3}\b/gi, ' ')
    .replace(/\bS\s*[0-9]{1,3}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 是否包含季/期标记 */
export function hasSeasonMarker(text: string): boolean {
  return /第\s*[0-9一二三四五六七八九十百零两〇]+\s*[季期]|(?:Season|S)\s*[0-9]+/i.test(text);
}

/** 给标题追加"第X季"；已有标记或 season ≤ 0 时原样返回。 */
export function appendSeasonToTitle(title: string, season: number | undefined): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized || !season || season <= 0 || hasSeasonMarker(normalized)) return normalized;
  return `${normalized} 第${toChineseNumberToken(season)}季`;
}

/** 标准化标题 token（小写、去除空格和标点），用于模糊比对 */
export function normalizeTitleToken(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\s\-_:：·・'"""''`~!！?？,，.。()/\\\[\]【】]/g, '')
    .trim();
}
