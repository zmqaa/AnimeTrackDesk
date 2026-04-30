import 'server-only';

import { createAiRuntimeConfig, getAiApiKey, requestAiJson as requestSharedAiJson } from './ai-runtime';
import { containsCjkText, uniqueStrings } from './anime-cast';
import { parseChineseNumberToken, appendSeasonToTitle, stripSeasonToken } from './chinese-parser';
import { fetchAiAnimeMetadata } from './metadata/ai-metadata-source';
import {
  toOptionalString, toOptionalNumber, toOptionalFiniteNumber, toOptionalNonNegativeNumber,
  toOptionalBoolean, toOptionalDateString, toStringArray, toOptionalQuickRecordStatus,
} from './ai-validation';

export interface EnrichedAnimeData {
  officialTitle: string;
  originalTitle?: string;
  totalEpisodes?: number;
  durationMinutes?: number;
  synopsis?: string;
  tags?: string[];
  premiereDate?: string;
  isFinished?: boolean;
  coverUrl?: string;
}

export interface ParsedWatchInput {
  animeTitle: string;
  originalTitle?: string;
  episode?: number;
  season?: number;
  watchedAt?: string;
}

export type ParsedQuickRecordStatus = 'watching' | 'completed' | 'dropped' | 'plan_to_watch';
export type ParsedQuickRecordTitleKind = 'official' | 'generic-season';

export interface ParsedQuickRecordIntent {
  animeTitle: string;
  originalTitle?: string;
  titleKind?: ParsedQuickRecordTitleKind;
  season?: number;
  episode?: number;
  progress?: number;
  watchedAt?: string;
  premiereDate?: string;
  status?: ParsedQuickRecordStatus;
  score?: number;
  notes?: string;
  tags?: string[];
  totalEpisodes?: number;
  durationMinutes?: number;
  summary?: string;
  coverUrl?: string;
  cast?: string[];
  castAliases?: string[];
  isFinished?: boolean;
  isHistorical?: boolean;
  rewatchTag?: string;
}

export interface ParsedQuickRecordBatch {
  records: ParsedQuickRecordIntent[];
}

type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const AI_RUNTIME = createAiRuntimeConfig();
const QUICK_RECORD_PARSE_TIMEOUT_MS = Math.max(3_000, Number(process.env.QUICK_RECORD_AI_TIMEOUT_MS || 12_000));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandInclusiveRange(start: number, end: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
    return [];
  }

  const result: number[] = [];
  const step = start <= end ? 1 : -1;
  for (let current = start; step > 0 ? current <= end : current >= end; current += step) {
    result.push(current);
  }

  return result;
}

function extractSeasonNumbersFromTextForTitle(inputText: string, animeTitle: string): number[] {
  const baseTitle = stripSeasonToken(animeTitle);
  if (!baseTitle) {
    return [];
  }

  const escapedTitle = escapeRegExp(baseTitle).replace(/\s+/g, '\\s*');
  const patterns = [
    new RegExp(`${escapedTitle}\\s*第\\s*([0-9一二三四五六七八九十百零两〇]+)\\s*(?:到|至|[-~～])\\s*第?\\s*([0-9一二三四五六七八九十百零两〇]+)\\s*季`),
    new RegExp(`${escapedTitle}\\s*第\\s*([0-9一二三四五六七八九十百零两〇]+)\\s*(?:、|和|及|跟|,|，)?\\s*第?\\s*([0-9一二三四五六七八九十百零两〇]+)\\s*季`),
  ];

  for (const pattern of patterns) {
    const match = inputText.match(pattern);
    if (!match) {
      continue;
    }

    const first = parseChineseNumberToken(match[1]);
    const second = parseChineseNumberToken(match[2]);
    if (!first || !second) {
      continue;
    }

    const expanded = pattern.source.includes('到|至') ? expandInclusiveRange(first, second) : uniqueStrings([String(first), String(second)]).map(Number);
    return expanded.filter((item) => Number.isFinite(item) && item > 0);
  }

  return [];
}

function normalizeQuickRecordTitleKind(value: unknown): ParsedQuickRecordTitleKind | undefined {
  const normalized = toOptionalString(value);
  if (normalized === 'official' || normalized === 'generic-season') {
    return normalized;
  }

  return undefined;
}

function normalizeQuickRecordTitle(
  animeTitleRaw: string | undefined,
  season: number | undefined,
  titleKind: ParsedQuickRecordTitleKind | undefined,
): string | undefined {
  const normalizedTitle = toOptionalString(animeTitleRaw);
  if (!normalizedTitle) {
    return undefined;
  }

  if (titleKind === 'official') {
    return normalizedTitle;
  }

  return appendSeasonToTitle(normalizedTitle, season);
}

function applyGlobalQuickRecordHints(inputText: string, batch: ParsedQuickRecordBatch): ParsedQuickRecordBatch {
  if (!Array.isArray(batch.records) || batch.records.length === 0) {
    return batch;
  }

  const hintedRecords = batch.records.map((record) => {
    const next: ParsedQuickRecordIntent = {
      ...record,
      animeTitle: normalizeQuickRecordTitle(record.animeTitle, record.season, record.titleKind) || record.animeTitle,
    };

    return next;
  });

  const groups = new Map<string, ParsedQuickRecordIntent[]>();
  for (const record of hintedRecords) {
    const key = stripSeasonToken(record.animeTitle) || record.animeTitle;
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)?.push(record);
  }

  const expandedRecords: ParsedQuickRecordIntent[] = [];
  for (const [baseTitle, records] of groups.entries()) {
    const explicitSeasons = extractSeasonNumbersFromTextForTitle(inputText, baseTitle);
    if (explicitSeasons.length > 1) {
      const template = records[0];
      for (const season of explicitSeasons) {
        expandedRecords.push({
          ...template,
          season,
          titleKind: 'generic-season',
          animeTitle: appendSeasonToTitle(baseTitle, season),
        });
      }
      continue;
    }

    expandedRecords.push(...records);
  }

  const deduped = Array.from(
    new Map(
      expandedRecords.map((record) => [
        `${record.animeTitle}::${record.originalTitle || ''}::${record.status || ''}::${record.isHistorical ? '1' : '0'}`,
        record,
      ])
    ).values()
  );

  return { records: deduped };
}

function cleanWatchSentenceTitle(text: string): string {
  return text
    .replace(/^(我)?\s*(今天|昨天|前天|昨晚|今晚|刚刚|刚才)?\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s*/i, '')
    .replace(/\s+(今天|昨天|前天|昨晚|今晚)\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s+/gi, ' ')
    .replace(/\s*(今天|昨天|前天|昨晚|今晚|刚刚|刚才)?\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s*$/i, ' ')
    .replace(/\s*(以前|之前|小时候|很久前|早就)?\s*(看完了|看完的|看完|看过了|看过的|看过|补完了|补完的|补完|补过了|补过的|补过|追完了|追完的|追完|追过了|追过的|追过|看了|补了|追了|刷了|重刷了|二刷了|看)\s*$/i, ' ')
    .replace(/\s*(以前|之前|小时候|很久前|早就)\s*$/i, ' ')
    .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*季/gi, ' ')
    .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*[集话話]/gi, ' ')
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*的\s*$/g, '')
    .trim();
}

function containsResidualWatchIntent(text: string): boolean {
  return /(以前|之前|小时候|很久前|早就|看完|看过|补完|补过|追完|追过|看了|补了|追了|刷了|重刷|二刷)/i.test(text);
}

function parseWatchInputFallback(inputText: string): ParsedWatchInput | null {
  const text = inputText.trim();
  if (!text) {
    return null;
  }

  const seasonToken = text.match(/第\s*([0-9一二三四五六七八九十百零两〇]+)\s*季/i)?.[1];
  const episodeToken = text.match(/第\s*([0-9一二三四五六七八九十百零两〇]+)\s*[集话話]/i)?.[1];

  const season = seasonToken ? parseChineseNumberToken(seasonToken) : undefined;
  const episode = episodeToken ? parseChineseNumberToken(episodeToken) : undefined;

  let animeTitle = cleanWatchSentenceTitle(text);

  if (!animeTitle) {
    animeTitle = text
      .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*季/gi, ' ')
      .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*[集话話]/gi, ' ')
      .replace(/[，。,.!！?？]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!animeTitle) {
    animeTitle = text;
  }

  animeTitle = animeTitle.replace(/\s+/g, ' ').trim();
  if (!animeTitle) {
    return null;
  }

  animeTitle = appendSeasonToTitle(animeTitle, season);

  return {
    animeTitle,
    season,
    episode,
  };
}

function parseQuickRecordBatchFallback(inputText: string): ParsedQuickRecordBatch {
  const single = parseWatchInputFallback(inputText);
  if (!single || containsResidualWatchIntent(single.animeTitle)) {
    return { records: [] };
  }

  return {
    records: [
      {
        animeTitle: single.animeTitle,
        originalTitle: single.originalTitle,
        titleKind: single.season ? 'generic-season' : undefined,
        season: single.season,
        episode: single.episode,
        progress: single.episode,
        watchedAt: single.watchedAt,
        status: single.episode ? 'watching' : undefined,
      },
    ],
  };
}

function normalizeQuickRecordIntent(value: unknown): ParsedQuickRecordIntent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const season = toOptionalNumber(payload.season);
  const titleKind = normalizeQuickRecordTitleKind(payload.titleKind);
  const animeTitleRaw =
    toOptionalString(payload.animeTitle) ||
    toOptionalString(payload.title) ||
    toOptionalString(payload.officialTitle);
  const animeTitle = normalizeQuickRecordTitle(animeTitleRaw, season, titleKind);

  if (!animeTitle) {
    return null;
  }

  const episode = toOptionalNumber(payload.episode);
  const progress = toOptionalNonNegativeNumber(payload.progress) ?? episode;

  return {
    animeTitle,
    originalTitle: toOptionalString(payload.originalTitle),
    titleKind,
    season,
    episode,
    progress,
    watchedAt: toOptionalDateString(payload.watchedAt),
    premiereDate: toOptionalDateString(payload.premiereDate),
    status: toOptionalQuickRecordStatus(payload.status),
    score: toOptionalFiniteNumber(payload.score),
    notes: toOptionalString(payload.notes),
    tags: toStringArray(payload.tags),
    totalEpisodes: toOptionalNumber(payload.totalEpisodes),
    durationMinutes: toOptionalNumber(payload.durationMinutes),
    summary: toOptionalString(payload.summary),
    coverUrl: toOptionalString(payload.coverUrl),
    cast: toStringArray(payload.cast),
    castAliases: toStringArray(payload.castAliases),
    isFinished: toOptionalBoolean(payload.isFinished),
    isHistorical: toOptionalBoolean(payload.isHistorical),
    rewatchTag: toOptionalString(payload.rewatchTag),
  };
}

function normalizeQuickRecordBatchPayload(payload: Record<string, unknown>): ParsedQuickRecordBatch {
  const rawRecords = Array.isArray(payload.records)
    ? payload.records
    : payload.record
      ? [payload.record]
      : ((payload.animeTitle || payload.title || payload.officialTitle) ? [payload] : []);

  const records = rawRecords
    .map(normalizeQuickRecordIntent)
    .filter((item): item is ParsedQuickRecordIntent => Boolean(item));

  return { records };
}

async function requestAiJson<T>(messages: AiMessage[], temperature = 0.2): Promise<T | null> {
  return requestSharedAiJson<T>({
    ...AI_RUNTIME,
    messages,
    temperature,
    timeoutMs: 30_000,
    cache: 'no-store',
  });
}

export async function enrichAnimeData(queryName: string): Promise<EnrichedAnimeData | null> {
  const normalizedQuery = queryName.trim();
  if (!normalizedQuery) {
    return null;
  }

  const metadata = await fetchAiAnimeMetadata(normalizedQuery, getAiApiKey());
  if (!metadata) {
    return null;
  }

  return {
    officialTitle: metadata.title || normalizedQuery,
    originalTitle: metadata.originalTitle,
    totalEpisodes: metadata.totalEpisodes,
    durationMinutes: metadata.durationMinutes,
    synopsis: metadata.summary,
    tags: metadata.tags,
    premiereDate: metadata.premiereDate,
    isFinished: metadata.isFinished,
    coverUrl: metadata.coverUrl,
  };
}

export async function buildVoiceActorAliases(cast: string[], existingAliases: string[] = []): Promise<string[]> {
  const baseAliases = uniqueStrings([...(existingAliases || []), ...(cast || [])]);
  if (baseAliases.length === 0) {
    return [];
  }

  const payload = await requestAiJson<Record<string, unknown>>(
    [
      {
        role: 'system',
        content: '你是日本声优姓名规范助手，只输出 JSON，不输出解释。',
      },
      {
        role: 'user',
        content: `
请为以下声优名字补充常见的简体中文别名。不确定时填 null。

输入：${JSON.stringify(baseAliases)}

返回 JSON：
{
  "actors": [
    { "name": "原始名字", "chineseName": "简体中文名或 null" }
  ]
}`,
      },
    ],
    0.2
  );

  const aiAliases = Array.isArray(payload?.actors)
    ? payload.actors.flatMap((actor) => {
        const chineseName = toOptionalString((actor as Record<string, unknown>)?.chineseName);
        return chineseName && containsCjkText(chineseName) ? [chineseName] : [];
      })
    : [];

  return uniqueStrings([...baseAliases, ...aiAliases]);
}

export async function parseQuickRecordBatch(inputText: string): Promise<ParsedQuickRecordBatch> {
  const normalizedText = inputText.trim();
  if (!normalizedText) {
    return { records: [] };
  }

  const payload = await requestSharedAiJson<Record<string, unknown>>({
    ...AI_RUNTIME,
    messages: [
      {
        role: 'system',
        content: '你是动漫观看记录结构化助手，只输出 JSON，不输出解释。未知信息留空，不要编造。你的核心任务是精确理解用户自然语言中的观看意图，特别是判断用户是"看完了整部/整季"还是"只看了某几集"。',
      },
      {
        role: 'user',
        content: `
请把这句话解析成动漫观看记录：${normalizedText}

输出 JSON：
{
  "records": [
    {
      "animeTitle": "通行标题，必须；优先使用最自然、最稳定的常用标题，不强制中文",
      "originalTitle": "原名，可空",
      "titleKind": "official|generic-season|null",
      "season": 1,
      "episode": 1,
      "progress": 1,
      "watchedAt": "YYYY-MM-DD，可空",
      "premiereDate": "YYYY-MM-DD，可空",
      "status": "watching|completed|dropped|plan_to_watch|null",
      "score": null,
      "notes": null,
      "tags": [],
      "totalEpisodes": null,
      "durationMinutes": null,
      "summary": null,
      "coverUrl": null,
      "cast": [],
      "castAliases": [],
      "isFinished": null,
      "isHistorical": false,
      "rewatchTag": null
    }
  ]
}

## 核心：观看状态判断

status 字段是最重要的判断。请从用户的自然语言中推断观看意图：

### status=completed（看完整部/整季）的识别信号：
- 明确说完："看完了""看完的""补完了""追完了""刷完了""啃完了""撸完了""肝完了"
- 过去式完成："看过""看过了""看过的""补过了""追过""补过"
- 定语修饰形式："以前看完的XXX""之前追完的XXX""小时候看过的XXX"
- 历史回忆语气："以前看的XXX""之前看的XXX""很久前看的XXX""小时候看的XXX"——当没有指定具体集数时，默认理解为看完整部
- 批量录入式："以前看完了A、B、C""之前补了A和B"

### status=watching（正在追/只看了部分）的识别信号：
- 提到具体集数："看了第一集""追到第5集""看到第三集"
- 正在进行："在看""在追""正在追""开始看了""刚开始看"
- 只说"看了"而非"看完了"且提到了集数

### 关键区分：
- "看完了XXX" / "看完的XXX" → completed（整部看完）
- "看完了XXX第3集" / "看完了第3集" → watching，episode=3（只看完单集）
- "以前看的XXX" → completed（回忆性表述，没有集数说明已经看完）
- "看了XXX第1集" → watching，episode=1（明确指定了集数）
- "看了XXX" → 如果没有任何集数信息，且有"以前/之前"等时间线索 → completed；否则 → watching

## 其他规则：
1. 一句话里如果明确提到多部作品或多条记录，拆成多个 records。
2. 如果出现“第一第二季 / 第一到第二季 / 第一、第二季”，必须拆成多个 seasons 对应的 records，不能只保留一个季。
3. animeTitle 必须对应“具体动画条目”的通行标题，不是原作总标题。
4. 如果作品没有稳定常用中文名，或者中文译名明显生硬、不自然，可以直接保留更常见的原文/英文/罗马字写法，例如“Slow Start”“NEW GAME!”；不要为了中文硬翻。
5. 如果该季或续作有稳定通行的官方中文副标题，直接使用官方标题，例如“南家三姐妹 再来一碗”“南家三姐妹 欢迎回来”；此时 titleKind=official，并且不要把标题改写成“第X季”。
6. 只有在无法确定该季官方中文副标题时，才使用“基础标题 第X季”；此时 titleKind=generic-season。
7. season 可以填写，但不要因为填了 season 就把官方标题强行改成“第X季”。
8. 只有用户明确提到的信息才填写；不知道就用 null、空字符串或空数组，不要补全设定。
9. "以前、之前、小时候、很久前、早就"这类表述，isHistorical=true；没给具体日期时 watchedAt 留空。
10. "二刷、三刷、重刷、重温、再刷"填到 rewatchTag。
11. 不要凭常识生成简介、封面、声优、总集数、时长、标签；这些后续会再补全。
12. 完全识别不出来时返回 {"records": []}。

## 示例：
- "我以前看完了我心里危险的东西第一第二季，还有阴阳眼见子" → 3 条：我心里危险的东西 第一季（completed）、我心里危险的东西 第二季（completed）、看得见的女孩（completed）；三条都 isHistorical=true。
- "我今天看了放学后海堤日记第一集" → 1 条，status=watching，episode=1，progress=1。
- "我以前看了南家三姐妹第二季" → 优先返回"南家三姐妹 再来一碗"，season=2，titleKind=official，status=completed，isHistorical=true。
- "以前看完的间谍过家家第二季" → 间谍过家家 第二季，status=completed，isHistorical=true。
- "之前看过孤独摇滚" → 孤独摇滚！，status=completed，isHistorical=true。
- "之前看过 slow start 和 new game" → Slow Start、NEW GAME!，status=completed，isHistorical=true。
- "我昨天开始看葬送的芙莉莲" → 葬送的芙莉莲，status=watching，episode 留空。
- "小时候看的名侦探柯南" → 名侦探柯南，status=completed，isHistorical=true。
- "我看了3集无职转生" → 无职转生，status=watching，episode=3，progress=3。`,
      },
    ],
    temperature: 0.1,
    timeoutMs: QUICK_RECORD_PARSE_TIMEOUT_MS,
    cache: 'no-store',
  });

  if (!payload) {
    return applyGlobalQuickRecordHints(normalizedText, parseQuickRecordBatchFallback(normalizedText));
  }

  const normalized = applyGlobalQuickRecordHints(normalizedText, normalizeQuickRecordBatchPayload(payload));
  if (normalized.records.length > 0) {
    return normalized;
  }

  return applyGlobalQuickRecordHints(normalizedText, parseQuickRecordBatchFallback(normalizedText));
}

export async function parseWatchInput(inputText: string): Promise<ParsedWatchInput | null> {
  const normalizedText = inputText.trim();
  if (!normalizedText) {
    return null;
  }

  const batch = await parseQuickRecordBatch(normalizedText);
  const first = batch.records[0];
  if (!first) {
    return null;
  }

  return {
    animeTitle: first.animeTitle,
    originalTitle: first.originalTitle,
    season: first.season,
    episode: first.episode ?? first.progress,
    watchedAt: first.watchedAt,
  };
}