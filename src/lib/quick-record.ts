import type { QuickRecordResponse } from "@/src/features/anime/anime-page-helpers";
import { uniqueStrings } from "@/lib/anime-cast";
import { fetchAnimeMetadataByQueriesWithTrace, type AnimeMetadataCandidate } from "@/lib/anime-provider";
import type { AnimeDetailItem, AnimeListItem, AnimeStatus } from "@/lib/anime-shared";
import {
  appendSeasonToTitle,
  extractSeasonNumber,
  hasSeasonMarker,
  normalizeTitleToken,
  parseChineseNumberToken,
  stripSeasonToken,
} from "@/lib/chinese-parser";
import {
  toOptionalBoolean,
  toOptionalDateString,
  toOptionalFiniteNumber,
  toOptionalNonNegativeNumber,
  toOptionalNumber,
  toOptionalQuickRecordStatus,
  toOptionalString,
  toStringArray,
} from "@/lib/ai-validation";
import {
  loadAnimeDetailItem,
  loadAnimeListItems,
  recordAnimeProgress,
  updateAnimeDetailItem,
  upsertAnimeItem,
} from "@/src/lib/anime-store";
import { loadSettings, type AiProviderSettings } from "@/src/lib/settings-store";

type ParsedQuickRecordTitleKind = "official" | "generic-season";
type ParsedQuickRecordStatus = "watching" | "completed" | "dropped" | "plan_to_watch";

type ParsedQuickRecordIntent = {
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
};

type ParsedQuickRecordBatch = {
  records: ParsedQuickRecordIntent[];
};

type QuickRecordResult = {
  created: boolean;
  replay: boolean;
  rewatchTag?: string;
  historyWritten: boolean;
  parsed: ParsedQuickRecordIntent;
  recognition: ReturnType<typeof buildRecognition>;
  entry: AnimeDetailItem;
};

type QuickRecordAiMetadata = {
  title?: string;
  originalTitle?: string;
  totalEpisodes?: number;
  durationMinutes?: number;
  summary?: string;
  tags?: string[];
  premiereDate?: string;
  isFinished?: boolean;
  coverUrl?: string;
};

type QuickRecordMetadata = Awaited<ReturnType<typeof fetchAnimeMetadataByQueriesWithTrace>>["metadata"] & {
  title?: string;
  originalTitle?: string;
  totalEpisodes?: number;
  durationMinutes?: number;
  description?: string;
  premiereDate?: string;
  isFinished?: boolean;
  coverUrl?: string;
  tags?: string[];
};

type QuickRecordCommand = "parse_quick_record" | "enrich_anime_metadata";

export type QuickRecordTraceStage = "parse" | "match" | "metadata" | "write" | "complete" | "error";
export type QuickRecordTraceStatus = "running" | "success" | "warning" | "error";

export type QuickRecordTraceEvent = {
  stage: QuickRecordTraceStage;
  status: QuickRecordTraceStatus;
  title: string;
  detail?: string;
  recordTitle?: string;
  queries?: string[];
  matchedTitle?: string;
  selectedTitle?: string;
  candidates?: AnimeMetadataCandidate[];
  created?: boolean;
  replay?: boolean;
  timestamp: number;
};

type QuickRecordTraceReporter = (event: QuickRecordTraceEvent) => void;

type QuickRecordOptions = {
  onTrace?: QuickRecordTraceReporter;
};

const QUICK_RECORD_HISTORY_NOTE = "通过桌面端 AI 录入补记了观看记录。";

function emitQuickRecordTrace(reporter: QuickRecordTraceReporter | undefined, event: Omit<QuickRecordTraceEvent, "timestamp">) {
  reporter?.({
    ...event,
    timestamp: Date.now(),
  });
}

function parseRewatchCountToken(token: string): number | undefined {
  const normalized = token.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 2 ? parsed : undefined;
  }

  const result = parseChineseNumberToken(normalized);
  return result !== undefined && result >= 2 ? result : undefined;
}

function detectRewatchTag(text: string): string | undefined {
  const compact = text.replace(/\s+/g, "");
  if (!compact) {
    return undefined;
  }

  const countToken = compact.match(/([0-9]{1,3}|[一二两三四五六七八九十]+)\s*刷/i)?.[1];
  if (countToken) {
    const count = parseRewatchCountToken(countToken);
    if (count && count >= 2) {
      return `${count}刷`;
    }
  }

  if (/二周目|重刷|重温|再刷/i.test(compact)) {
    return "二刷";
  }

  return undefined;
}

function parseRewatchTagCount(tag: string): number | undefined {
  const match = tag.trim().match(/^([0-9]{1,3}|[一二两三四五六七八九十]+)刷$/i);
  if (!match) {
    return undefined;
  }

  return parseRewatchCountToken(match[1]);
}

function formatRewatchTag(count: number): string {
  const cjkMap: Record<number, string> = { 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九", 10: "十" };
  return cjkMap[count] ? `${cjkMap[count]}刷` : `${count}刷`;
}

function resolveNextRewatchTag(records: Pick<AnimeListItem, "tags">[]) {
  let highestCount = 1;

  for (const record of records) {
    for (const tag of record.tags ?? []) {
      const parsed = parseRewatchTagCount(tag);
      if (parsed && parsed > highestCount) {
        highestCount = parsed;
      }
    }
  }

  return formatRewatchTag(Math.max(2, highestCount + 1));
}

function isCompletedAnimeRecord(record: Pick<AnimeListItem, "status" | "progress" | "totalEpisodes">) {
  const totalEpisodes = record.totalEpisodes ?? undefined;
  const finishedByProgress = Boolean(totalEpisodes) && record.progress >= Number(totalEpisodes);
  return record.status === "completed" || finishedByProgress;
}

function shouldAutoResolveRewatch(
  parsed: Pick<ParsedQuickRecordIntent, "status" | "episode" | "progress">,
  anime: Pick<AnimeListItem, "status" | "progress" | "totalEpisodes">,
) {
  if (!isCompletedAnimeRecord(anime)) {
    return false;
  }

  if (parsed.status === "plan_to_watch" || parsed.status === "dropped") {
    return false;
  }

  if (parsed.status === "completed") {
    return true;
  }

  const requestedProgress = parsed.progress ?? parsed.episode;
  if (requestedProgress === undefined) {
    return true;
  }

  if (
    requestedProgress !== undefined
    && anime.totalEpisodes
    && anime.totalEpisodes > 0
    && requestedProgress >= anime.totalEpisodes
  ) {
    return true;
  }

  return parsed.episode === 1 || parsed.progress === 1;
}

function toDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveRecordedDateString(parsed: ParsedQuickRecordIntent) {
  return parsed.watchedAt || (!parsed.isHistorical ? toDateString(new Date()) : undefined);
}

function hasExplicitProgress(parsed: Pick<ParsedQuickRecordIntent, "progress" | "episode">) {
  return parsed.progress !== undefined || parsed.episode !== undefined;
}

function resolveIntentStatus(parsed: ParsedQuickRecordIntent, progress: number) {
  if (!hasExplicitProgress(parsed)) {
    return parsed.status || "watching";
  }

  if (parsed.status) {
    return parsed.status;
  }

  if (progress > 0) {
    return "watching" satisfies AnimeStatus;
  }

  return "plan_to_watch" satisfies AnimeStatus;
}

function resolveTargetProgress(parsed: ParsedQuickRecordIntent, currentProgress: number, totalEpisodes?: number) {
  if (!hasExplicitProgress(parsed)) {
    return currentProgress;
  }

  if (parsed.status === "completed" && totalEpisodes && totalEpisodes > 0) {
    return totalEpisodes;
  }

  if (parsed.progress !== undefined && parsed.progress > 0) {
    return parsed.progress;
  }

  if (parsed.episode !== undefined && parsed.episode > 0) {
    return parsed.episode;
  }

  if (parsed.status === "plan_to_watch" || parsed.status === "completed") {
    return currentProgress;
  }

  return currentProgress > 0 ? currentProgress + 1 : 1;
}

function resolveCreateTitle(parsed: ParsedQuickRecordIntent, metadataTitle: string | undefined) {
  const normalizedMetadataTitle = toOptionalString(metadataTitle);
  if (!normalizedMetadataTitle) {
    return parsed.animeTitle;
  }

  const requestedSeason = getResolvedParsedSeason(parsed);
  if (!requestedSeason) {
    const metadataSeason = extractSeasonNumber(normalizedMetadataTitle);
    if (metadataSeason === 1) {
      const strippedMetadataTitle = stripSeasonToken(normalizedMetadataTitle);
      return strippedMetadataTitle || normalizedMetadataTitle;
    }

    return normalizedMetadataTitle;
  }

  const metadataSeason = extractSeasonNumber(normalizedMetadataTitle);
  const parsedBaseTitle = normalizeTitleToken(stripSeasonToken(parsed.animeTitle));
  const metadataBaseTitle = normalizeTitleToken(stripSeasonToken(normalizedMetadataTitle));

  if (requestedSeason === 1 && parsedBaseTitle && metadataBaseTitle && parsedBaseTitle === metadataBaseTitle) {
    const strippedMetadataTitle = stripSeasonToken(normalizedMetadataTitle);
    return strippedMetadataTitle || normalizedMetadataTitle;
  }

  if (metadataSeason === requestedSeason && parsedBaseTitle && metadataBaseTitle && parsedBaseTitle === metadataBaseTitle) {
    return normalizedMetadataTitle;
  }

  if (/\p{Script=Han}/u.test(normalizedMetadataTitle)) {
    return normalizedMetadataTitle;
  }

  return parsed.animeTitle;
}

function mergeStringArrays(...arrays: Array<string[] | undefined>) {
  const merged = uniqueStrings(arrays.flatMap((items) => items || []));
  return merged.length > 0 ? merged : undefined;
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function hasPatchChanges(patch: Record<string, unknown>) {
  return Object.values(patch).some((value) => value !== undefined);
}

function buildRecognition(
  parsed: ParsedQuickRecordIntent,
  entry: Pick<AnimeDetailItem, "title" | "originalTitle"> | undefined,
  progress: number,
  enriched: boolean,
  historyWritten: boolean,
  watchedAt: string | undefined,
  status: string,
) {
  return {
    standardTitle: parsed.animeTitle,
    originalTitle: parsed.originalTitle || null,
    season: parsed.season || null,
    episode: parsed.episode ?? null,
    progress,
    status,
    watchedAt: watchedAt || null,
    matchedTitle: entry?.title || null,
    matchedOriginalTitle: entry?.originalTitle || null,
    isHistorical: Boolean(parsed.isHistorical),
    enriched,
    historyWritten,
  };
}

function normalizeQuickRecordTitleKind(value: unknown): ParsedQuickRecordTitleKind | undefined {
  const normalized = toOptionalString(value);
  if (normalized === "official" || normalized === "generic-season") {
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

  if (titleKind === "official") {
    return normalizedTitle;
  }

  return appendSeasonToTitle(normalizedTitle, season);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandInclusiveRange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
    return [] as number[];
  }

  const result: number[] = [];
  const step = start <= end ? 1 : -1;

  for (let current = start; step > 0 ? current <= end : current >= end; current += step) {
    result.push(current);
  }

  return result;
}

function hasExplicitSeasonInRecord(record: Pick<ParsedQuickRecordIntent, "animeTitle" | "originalTitle" | "season">) {
  return Boolean(
    record.season
    || hasSeasonMarker(record.animeTitle)
    || (record.originalTitle && hasSeasonMarker(record.originalTitle)),
  );
}

function getParsedRecordSeason(record: Pick<ParsedQuickRecordIntent, "animeTitle" | "originalTitle" | "season">) {
  return record.season ?? extractSeasonNumber(record.animeTitle) ?? extractSeasonNumber(record.originalTitle);
}

function realignRecordToExplicitSeason(
  record: ParsedQuickRecordIntent,
  explicitSeason: number,
  fallbackBaseTitle: string,
): ParsedQuickRecordIntent {
  const baseTitle = stripSeasonToken(record.animeTitle) || stripSeasonToken(record.originalTitle) || fallbackBaseTitle || record.animeTitle;
  return {
    ...record,
    season: explicitSeason,
    titleKind: "generic-season",
    animeTitle: appendSeasonToTitle(baseTitle, explicitSeason),
    originalTitle: undefined,
  };
}

function extractSeasonNumbersFromTextForTitle(inputText: string, animeTitle: string) {
  const baseTitle = stripSeasonToken(animeTitle);
  if (!baseTitle) {
    return [] as number[];
  }

  const escapedTitle = escapeRegExp(baseTitle).replace(/\s+/g, "\\s*");
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

    const expanded = pattern.source.includes("到|至")
      ? expandInclusiveRange(first, second)
      : uniqueStrings([String(first), String(second)]).map(Number);
    return expanded.filter((item) => Number.isFinite(item) && item > 0);
  }

  const singleSeasonMatch = inputText.match(
    new RegExp(`${escapedTitle}\\s*第\\s*([0-9一二三四五六七八九十百零两〇]+)\\s*季`),
  );
  const singleSeason = singleSeasonMatch ? parseChineseNumberToken(singleSeasonMatch[1]) : undefined;
  if (singleSeason && singleSeason > 0) {
    return [singleSeason];
  }

  return [] as number[];
}

function applyGlobalQuickRecordHints(inputText: string, batch: ParsedQuickRecordBatch): ParsedQuickRecordBatch {
  if (!Array.isArray(batch.records) || batch.records.length === 0) {
    return batch;
  }

  const hintedRecords = batch.records.map((record) => ({
    ...record,
    animeTitle: normalizeQuickRecordTitle(record.animeTitle, record.season, record.titleKind) || record.animeTitle,
  }));

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
          titleKind: "generic-season",
          animeTitle: appendSeasonToTitle(baseTitle, season),
        });
      }
      continue;
    }

    if (explicitSeasons.length === 1) {
      const [season] = explicitSeasons;
      expandedRecords.push(
        ...records.map((record): ParsedQuickRecordIntent => {
          const recordSeason = getParsedRecordSeason(record);
          if (recordSeason && recordSeason !== season) {
            return realignRecordToExplicitSeason(record, season, baseTitle);
          }

          if (hasExplicitSeasonInRecord(record)) {
            return record;
          }

          return {
            ...record,
            season,
            titleKind: record.titleKind === "official" ? "official" : "generic-season",
            animeTitle: appendSeasonToTitle(baseTitle, season),
          };
        }),
      );
      continue;
    }

    expandedRecords.push(...records);
  }

  return {
    records: Array.from(
      new Map(
        expandedRecords.map((record) => [
          `${record.animeTitle}::${record.originalTitle || ""}::${record.status || ""}::${record.isHistorical ? "1" : "0"}`,
          record,
        ]),
      ).values(),
    ),
  };
}

function cleanWatchSentenceTitle(text: string) {
  return text
    .replace(/^(我)?\s*(今天|昨天|前天|昨晚|今晚|刚刚|刚才)?\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s*/i, "")
    .replace(/\s+(今天|昨天|前天|昨晚|今晚)\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s+/gi, " ")
    .replace(/\s*(今天|昨天|前天|昨晚|今晚|刚刚|刚才)?\s*(看了|补了|追了|刷了|重刷了|二刷了|看完了|看完|看)\s*$/i, " ")
    .replace(/\s*(以前|之前|小时候|很久前|早就)?\s*(看完了|看完的|看完|看过了|看过的|看过|补完了|补完的|补完|补过了|补过的|补过|追完了|追完的|追完|追过了|追过的|追过|看了|补了|追了|刷了|重刷了|二刷了|看)\s*$/i, " ")
    .replace(/\s*(以前|之前|小时候|很久前|早就)\s*$/i, " ")
    .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*季/gi, " ")
    .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*[集话話]/gi, " ")
    .replace(/[，。,.!！?？]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*的\s*$/g, "")
    .trim();
}

function containsResidualWatchIntent(text: string) {
  return /(以前|之前|小时候|很久前|早就|看完|看过|补完|补过|追完|追过|看了|补了|追了|刷了|重刷|二刷)/i.test(text);
}

function parseQuickRecordBatchFallback(inputText: string): ParsedQuickRecordBatch {
  const text = inputText.trim();
  if (!text) {
    return { records: [] };
  }

  const seasonToken = text.match(/第\s*([0-9一二三四五六七八九十百零两〇]+)\s*季/i)?.[1];
  const episodeToken = text.match(/第\s*([0-9一二三四五六七八九十百零两〇]+)\s*[集话話]/i)?.[1];
  const season = seasonToken ? parseChineseNumberToken(seasonToken) : undefined;
  const episode = episodeToken ? parseChineseNumberToken(episodeToken) : undefined;

  let animeTitle = cleanWatchSentenceTitle(text);
  if (!animeTitle) {
    animeTitle = text
      .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*季/gi, " ")
      .replace(/第\s*[0-9一二三四五六七八九十百零两〇]+\s*[集话話]/gi, " ")
      .replace(/[，。,.!！?？]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  animeTitle = appendSeasonToTitle(animeTitle || text, season);
  if (!animeTitle || containsResidualWatchIntent(animeTitle)) {
    return { records: [] };
  }

  return {
    records: [{
      animeTitle,
      titleKind: season ? "generic-season" : undefined,
      season,
      episode,
      progress: episode,
      status: episode ? "watching" : undefined,
    }],
  };
}

function normalizeQuickRecordIntent(value: unknown): ParsedQuickRecordIntent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const season = toOptionalNumber(payload.season);
  const titleKind = normalizeQuickRecordTitleKind(payload.titleKind);
  const animeTitleRaw =
    toOptionalString(payload.animeTitle)
    || toOptionalString(payload.title)
    || toOptionalString(payload.officialTitle);
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

  return {
    records: rawRecords
      .map(normalizeQuickRecordIntent)
      .filter((item): item is ParsedQuickRecordIntent => Boolean(item)),
  };
}

async function invokeQuickRecordCommand<T>(command: QuickRecordCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function ensureQuickRecordAiSettings(value: AiProviderSettings) {
  if (!value.enabled) {
    throw new Error("请先在设置页启用 AI Provider，然后再使用 AI 录入。");
  }

  if (!value.provider.trim() || !value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) {
    throw new Error("AI 录入前，请先在设置页补齐 Provider、Base URL、模型和 API Key。");
  }
}

function hasReadyQuickRecordAiSettings(value: AiProviderSettings) {
  return value.enabled
    && Boolean(value.provider.trim())
    && Boolean(value.baseUrl.trim())
    && Boolean(value.model.trim())
    && Boolean(value.apiKey.trim());
}

function normalizeQuickRecordAiMetadataPayload(value: unknown): QuickRecordAiMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  return {
    title: toOptionalString(payload.officialTitle) || toOptionalString(payload.title),
    originalTitle: toOptionalString(payload.originalTitle),
    totalEpisodes: toOptionalNumber(payload.totalEpisodes),
    durationMinutes: toOptionalNumber(payload.durationMinutes),
    summary: toOptionalString(payload.synopsis) || toOptionalString(payload.summary),
    tags: toStringArray(payload.tags),
    premiereDate: toOptionalDateString(payload.premiereDate),
    isFinished: toOptionalBoolean(payload.isFinished),
    coverUrl: toOptionalString(payload.coverUrl),
  };
}

async function fetchQuickRecordAiMetadata(queryName: string, settings: AiProviderSettings) {
  if (!hasReadyQuickRecordAiSettings(settings)) {
    return null;
  }

  const response = await invokeQuickRecordCommand<Record<string, unknown>>("enrich_anime_metadata", {
    queryName,
    settings,
  });

  return normalizeQuickRecordAiMetadataPayload(response);
}

function buildQuickRecordProviderQueries(parsed: ParsedQuickRecordIntent, aiMetadata: QuickRecordAiMetadata | null) {
  const requestedSeason = parsed.season ?? extractSeasonNumber(parsed.animeTitle) ?? extractSeasonNumber(parsed.originalTitle);
  const isSeasonCompatible = (value: string | undefined) => {
    const normalized = value?.trim();
    if (!normalized || !requestedSeason) {
      return Boolean(normalized);
    }

    const candidateSeason = extractSeasonNumber(normalized);
    return candidateSeason === undefined || candidateSeason === requestedSeason;
  };

  return Array.from(
    new Set(
      [
        aiMetadata?.originalTitle,
        aiMetadata?.title,
        parsed.originalTitle,
        parsed.animeTitle,
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value) && isSeasonCompatible(value)),
    ),
  );
}

async function parseQuickRecordBatch(inputText: string, settings: AiProviderSettings): Promise<ParsedQuickRecordBatch> {
  const normalizedText = inputText.trim();
  if (!normalizedText) {
    return { records: [] };
  }

  const response = await invokeQuickRecordCommand<Record<string, unknown>>("parse_quick_record", {
    text: normalizedText,
    settings,
  });

  if (!response) {
    return applyGlobalQuickRecordHints(normalizedText, parseQuickRecordBatchFallback(normalizedText));
  }

  const normalized = applyGlobalQuickRecordHints(normalizedText, normalizeQuickRecordBatchPayload(response));
  if (normalized.records.length > 0) {
    return normalized;
  }

  return applyGlobalQuickRecordHints(normalizedText, parseQuickRecordBatchFallback(normalizedText));
}

function getItemTitleTokens(item: Pick<AnimeListItem, "title" | "originalTitle">) {
  return uniqueStrings([
    normalizeTitleToken(item.title),
    normalizeTitleToken(item.originalTitle),
  ]);
}

function getItemBaseTitleTokens(item: Pick<AnimeListItem, "title" | "originalTitle">) {
  return uniqueStrings([
    normalizeTitleToken(stripSeasonToken(item.title)),
    normalizeTitleToken(stripSeasonToken(item.originalTitle)),
  ]);
}

function getResolvedItemSeason(item: Pick<AnimeListItem, "title" | "originalTitle">) {
  return extractSeasonNumber(item.title) ?? extractSeasonNumber(item.originalTitle);
}

function getResolvedParsedSeason(parsed: Pick<ParsedQuickRecordIntent, "animeTitle" | "originalTitle" | "season">) {
  return parsed.season ?? extractSeasonNumber(parsed.animeTitle) ?? extractSeasonNumber(parsed.originalTitle);
}

function sortMatchingAnime(left: AnimeListItem, right: AnimeListItem) {
  const leftWatching = left.status !== "completed";
  const rightWatching = right.status !== "completed";
  if (leftWatching !== rightWatching) {
    return leftWatching ? -1 : 1;
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function findMatchingAnime(items: AnimeListItem[], parsed: ParsedQuickRecordIntent) {
  const exactTargetTokens = uniqueStrings([
    normalizeTitleToken(parsed.animeTitle),
    normalizeTitleToken(parsed.originalTitle),
  ]);
  const baseTargetTokens = uniqueStrings([
    normalizeTitleToken(stripSeasonToken(parsed.animeTitle)),
    normalizeTitleToken(stripSeasonToken(parsed.originalTitle)),
  ]);
  const hasExplicitSeason = Boolean(
    parsed.season
    || hasSeasonMarker(parsed.animeTitle)
    || (parsed.originalTitle && hasSeasonMarker(parsed.originalTitle)),
  );
  const requestedSeason = getResolvedParsedSeason(parsed);

  const exactMatches = items
    .filter((item) => getItemTitleTokens(item).some((token) => exactTargetTokens.includes(token)))
    .sort(sortMatchingAnime);

  if (requestedSeason) {
    const exactSeasonMatch = exactMatches.find((item) => getResolvedItemSeason(item) === requestedSeason);
    if (exactSeasonMatch) {
      return exactSeasonMatch;
    }
  }

  const exactMatch = exactMatches[0];

  if (exactMatch && (!requestedSeason || getResolvedItemSeason(exactMatch) === undefined || getResolvedItemSeason(exactMatch) === requestedSeason)) {
    return exactMatch;
  }

  if (requestedSeason) {
    const seasonAwareBaseMatch = items
      .filter((item) => (
        getResolvedItemSeason(item) === requestedSeason
        && getItemBaseTitleTokens(item).some((token) => baseTargetTokens.includes(token))
      ))
      .sort(sortMatchingAnime)[0];

    if (seasonAwareBaseMatch) {
      return seasonAwareBaseMatch;
    }
  }

  if (hasExplicitSeason) {
    return null;
  }

  return items
    .filter((item) => getItemBaseTitleTokens(item).some((token) => baseTargetTokens.includes(token)))
    .sort(sortMatchingAnime)[0] || null;
}

function findRelatedRecords(items: AnimeListItem[], target: Pick<AnimeListItem, "title" | "originalTitle">) {
  const titleToken = normalizeTitleToken(target.title);
  const baseTokens = getItemBaseTitleTokens(target);
  const targetSeason = getResolvedItemSeason(target);

  return items.filter((item) => {
    if (targetSeason) {
      return getResolvedItemSeason(item) === targetSeason
        && getItemBaseTitleTokens(item).some((token) => baseTokens.includes(token));
    }

    return getItemTitleTokens(item).includes(titleToken);
  });
}

function buildMetadataEnrichedFlag(parsed: ParsedQuickRecordIntent, detail: AnimeDetailItem) {
  return Boolean(
    (!parsed.originalTitle && detail.originalTitle)
    || (!parsed.coverUrl && detail.coverUrl)
    || (!parsed.summary && detail.summary)
    || (parsed.score === undefined && detail.score !== undefined)
    || (!parsed.totalEpisodes && detail.totalEpisodes)
    || (!parsed.durationMinutes && detail.durationMinutes)
    || (!(parsed.tags && parsed.tags.length > 0) && detail.tags && detail.tags.length > 0)
    || (!(parsed.cast && parsed.cast.length > 0) && detail.cast && detail.cast.length > 0)
    || (!parsed.premiereDate && detail.premiereDate)
    || (parsed.isFinished === undefined && detail.isFinished !== undefined)
  );
}

function choosePreferredMetadataName(
  parsed: Pick<ParsedQuickRecordIntent, "animeTitle" | "originalTitle" | "season">,
  aiName: string | undefined,
  providerName: string | undefined,
) {
  const normalizedAiName = toOptionalString(aiName);
  if (!normalizedAiName) {
    return toOptionalString(providerName);
  }

  const normalizedProviderName = toOptionalString(providerName);
  if (!normalizedProviderName) {
    return normalizedAiName;
  }

  const requestedSeason = getResolvedParsedSeason(parsed);
  const aiBaseTitle = normalizeTitleToken(stripSeasonToken(normalizedAiName));
  const providerBaseTitle = normalizeTitleToken(stripSeasonToken(normalizedProviderName));

  if (!requestedSeason || !aiBaseTitle || !providerBaseTitle || aiBaseTitle !== providerBaseTitle) {
    return normalizedProviderName;
  }

  const aiSeason = extractSeasonNumber(normalizedAiName);
  const providerSeason = extractSeasonNumber(normalizedProviderName);
  const aiLooksSeasonSpecific = aiSeason === requestedSeason;
  const providerLooksSeasonSpecific = providerSeason === requestedSeason;

  if (aiLooksSeasonSpecific && !providerLooksSeasonSpecific) {
    return normalizedAiName;
  }

  if (aiLooksSeasonSpecific && providerSeason !== undefined && providerSeason !== requestedSeason) {
    return normalizedAiName;
  }

  return normalizedProviderName;
}

async function enrichMetadata(parsed: ParsedQuickRecordIntent, settings: AiProviderSettings) {
  const queries = buildQuickRecordProviderQueries(parsed, null);

  try {
    const aiMetadata = await fetchQuickRecordAiMetadata(parsed.originalTitle?.trim() || parsed.animeTitle.trim(), settings);
    const providerQueries = buildQuickRecordProviderQueries(parsed, aiMetadata);
    const providerResult = await fetchAnimeMetadataByQueriesWithTrace(...providerQueries);
    const providerMetadata = providerResult.metadata;

    if (!providerMetadata && !aiMetadata) {
      return {
        metadata: null,
        queries: providerQueries.length > 0 ? providerQueries : queries,
        candidates: providerResult.trace.flatMap((item) => item.candidates).slice(0, 4),
        selectedTitle: providerResult.selected?.title,
      };
    }

    const merged: QuickRecordMetadata = {
      ...providerMetadata,
      title: choosePreferredMetadataName(parsed, aiMetadata?.title, providerMetadata?.title),
      originalTitle: choosePreferredMetadataName(parsed, aiMetadata?.originalTitle, providerMetadata?.originalTitle),
      totalEpisodes: providerMetadata?.totalEpisodes ?? aiMetadata?.totalEpisodes,
      durationMinutes: aiMetadata?.durationMinutes ?? providerMetadata?.durationMinutes,
      description: providerMetadata?.description || aiMetadata?.summary,
      premiereDate: providerMetadata?.premiereDate || aiMetadata?.premiereDate,
      isFinished: providerMetadata?.isFinished ?? aiMetadata?.isFinished,
      coverUrl: providerMetadata?.coverUrl || aiMetadata?.coverUrl,
      tags: uniqueStrings([...(aiMetadata?.tags || []), ...(providerMetadata?.tags || [])]),
    };

    return {
      metadata: merged,
      queries: providerQueries.length > 0 ? providerQueries : queries,
      candidates: providerResult.trace.flatMap((item) => item.candidates).slice(0, 4),
      selectedTitle: providerResult.selected?.title || merged.title || merged.originalTitle,
    };
  } catch {
    return {
      metadata: null,
      queries,
      candidates: [],
      selectedTitle: undefined,
    };
  }
}

function resolveCompletedProgress(progress: number, status: AnimeStatus | ParsedQuickRecordStatus | undefined, totalEpisodes?: number) {
  if (status === "completed" && totalEpisodes && totalEpisodes > 0) {
    return totalEpisodes;
  }

  if (status === "completed" && progress === 0) {
    return 1;
  }

  return progress;
}

async function processCreateQuickRecord(
  parsedInput: ParsedQuickRecordIntent,
  options: { rewatchTag?: string; rawText?: string; aiSettings: AiProviderSettings; trace?: QuickRecordTraceReporter },
): Promise<QuickRecordResult> {
  const parsed = { ...parsedInput, animeTitle: parsedInput.animeTitle.trim() };
  const shouldApplyProgress = hasExplicitProgress(parsed) || parsed.status === "completed";
  emitQuickRecordTrace(options.trace, {
    stage: "metadata",
    status: "running",
    title: "正在补齐元数据",
    detail: "准备查询 AI 和 Bangumi 元数据",
    recordTitle: parsed.animeTitle,
  });

  const metadataResult = await enrichMetadata(parsed, options.aiSettings);
  const metadata = metadataResult.metadata;
  emitQuickRecordTrace(options.trace, {
    stage: "metadata",
    status: metadata ? "success" : "warning",
    title: metadata ? "元数据补齐完成" : "未补到更多元数据",
    detail: metadata
      ? `命中：${metadata.title || metadata.originalTitle || parsed.animeTitle}`
      : "这次没有查到额外的标题、集数、时长或简介",
    recordTitle: parsed.animeTitle,
    queries: metadataResult.queries,
    selectedTitle: metadataResult.selectedTitle || metadata?.title || metadata?.originalTitle,
    candidates: metadataResult.candidates,
  });

  emitQuickRecordTrace(options.trace, {
    stage: "write",
    status: "running",
    title: "正在写入数据库",
    detail: "准备新建条目并应用识别结果",
    recordTitle: parsed.animeTitle,
    created: true,
  });

  const created = upsertAnimeItem(null, {
    title: resolveCreateTitle(parsed, metadata?.title),
    originalTitle: metadata?.originalTitle || parsed.originalTitle,
    progress: 0,
    totalEpisodes: parsed.totalEpisodes || metadata?.totalEpisodes,
    status: parsed.status === "plan_to_watch" ? "plan_to_watch" : "watching",
    score: parsed.score ?? metadata?.score,
    coverUrl: parsed.coverUrl || metadata?.coverUrl,
    tags: uniqueStrings([...(metadata?.tags || []), ...(parsed.tags || []), options.rewatchTag]),
    durationMinutes: parsed.durationMinutes ?? metadata?.durationMinutes,
    startDate: undefined,
    endDate: undefined,
    isFinished: parsed.isFinished ?? metadata?.isFinished ?? false,
  });

  let entry = loadAnimeDetailItem(created.entry.id);
  if (!entry) {
    throw new Error("AI 录入后未能读取新建条目");
  }

  const createPatch = {
    summary: parsed.summary || metadata?.description,
    premiereDate: parsed.premiereDate || metadata?.premiereDate,
    cast: mergeStringArrays(metadata?.cast, parsed.cast),
    score: created.entry.score === undefined ? (parsed.score ?? metadata?.score) : undefined,
    durationMinutes: created.entry.durationMinutes === undefined ? (parsed.durationMinutes ?? metadata?.durationMinutes) : undefined,
  };

  if (hasPatchChanges(createPatch)) {
    entry = updateAnimeDetailItem(entry.id, createPatch).entry;
  }

  const recordedDateString = resolveRecordedDateString(parsed);
  const targetProgress = shouldApplyProgress
    ? resolveCompletedProgress(
      resolveTargetProgress(parsed, 0, entry.totalEpisodes || undefined),
      parsed.status,
      entry.totalEpisodes || undefined,
    )
    : 0;
  const resolvedStatus = resolveIntentStatus(parsed, targetProgress);
  const shouldWriteHistory = shouldApplyProgress
    && Boolean(recordedDateString)
    && targetProgress > 0
    && resolvedStatus !== "plan_to_watch";

  if (shouldApplyProgress && (targetProgress > 0 || resolvedStatus === "completed")) {
    recordAnimeProgress({
      id: entry.id,
      requestedProgress: targetProgress,
      totalEpisodes: entry.totalEpisodes,
      watchedAt: recordedDateString,
      note: QUICK_RECORD_HISTORY_NOTE,
      forceHistory: shouldWriteHistory,
      autoFillCompletionDate: false,
    });
    entry = loadAnimeDetailItem(entry.id) || entry;
  }

  if (resolvedStatus !== entry.status) {
    entry = updateAnimeDetailItem(entry.id, { status: resolvedStatus, autoFillCompletionDate: false }).entry;
  }

  const metadataEnriched = buildMetadataEnrichedFlag(parsed, entry);
  emitQuickRecordTrace(options.trace, {
    stage: "write",
    status: "success",
    title: "写入完成",
    detail: `${entry.title}${entry.progress > 0 ? `，当前 EP ${entry.progress}` : ""}`,
    recordTitle: parsed.animeTitle,
    matchedTitle: entry.title,
    created: true,
  });
  return {
    created: true,
    replay: false,
    rewatchTag: options.rewatchTag,
    historyWritten: shouldWriteHistory,
    parsed,
    recognition: buildRecognition(parsed, entry, entry.progress, metadataEnriched, shouldWriteHistory, recordedDateString, entry.status),
    entry,
  };
}

async function processUpdateQuickRecord(
  parsedInput: ParsedQuickRecordIntent,
  current: AnimeListItem,
  aiSettings: AiProviderSettings,
  trace?: QuickRecordTraceReporter,
): Promise<QuickRecordResult> {
  const parsed = { ...parsedInput, animeTitle: parsedInput.animeTitle.trim() };
  const shouldApplyProgress = hasExplicitProgress(parsed) || parsed.status === "completed";
  let detail = loadAnimeDetailItem(current.id);
  if (!detail) {
    throw new Error("未找到对应番剧");
  }

  emitQuickRecordTrace(trace, {
    stage: "metadata",
    status: "running",
    title: "正在补齐元数据",
    detail: "准备查询 AI 和 Bangumi 元数据",
    recordTitle: parsed.animeTitle,
  });

  const metadataResult = await enrichMetadata(parsed, aiSettings);
  const metadata = metadataResult.metadata;
  emitQuickRecordTrace(trace, {
    stage: "metadata",
    status: metadata ? "success" : "warning",
    title: metadata ? "元数据补齐完成" : "未补到更多元数据",
    detail: metadata
      ? `命中：${metadata.title || metadata.originalTitle || current.title}`
      : "这次没有查到额外的标题、集数、时长或简介",
    recordTitle: parsed.animeTitle,
    queries: metadataResult.queries,
    selectedTitle: metadataResult.selectedTitle || metadata?.title || metadata?.originalTitle,
    candidates: metadataResult.candidates,
  });

  emitQuickRecordTrace(trace, {
    stage: "write",
    status: "running",
    title: "正在写入数据库",
    detail: `准备更新现有条目：${current.title}`,
    recordTitle: parsed.animeTitle,
    matchedTitle: current.title,
    created: false,
  });

  const effectiveTotalEpisodes = parsed.totalEpisodes || detail.totalEpisodes || metadata?.totalEpisodes;
  const targetProgress = shouldApplyProgress
    ? resolveCompletedProgress(
      resolveTargetProgress(parsed, detail.progress, effectiveTotalEpisodes),
      parsed.status,
      effectiveTotalEpisodes,
    )
    : detail.progress;
  const mergedTags = mergeStringArrays(detail.tags, metadata?.tags, parsed.tags);
  const mergedCast = mergeStringArrays(detail.cast, metadata?.cast, parsed.cast);
  const patch = {
    originalTitle: !detail.originalTitle ? (metadata?.originalTitle || parsed.originalTitle) : undefined,
    score: (detail.score === undefined || detail.score <= 0) ? (parsed.score ?? metadata?.score) : undefined,
    totalEpisodes: !detail.totalEpisodes && effectiveTotalEpisodes ? effectiveTotalEpisodes : undefined,
    durationMinutes: detail.durationMinutes === undefined ? (parsed.durationMinutes ?? metadata?.durationMinutes) : undefined,
    summary: !detail.summary ? (parsed.summary || metadata?.description) : undefined,
    coverUrl: !detail.coverUrl ? (parsed.coverUrl || metadata?.coverUrl) : undefined,
    premiereDate: !detail.premiereDate ? (parsed.premiereDate || metadata?.premiereDate) : undefined,
    tags: sameStringArray(mergedTags, detail.tags) ? undefined : mergedTags,
    cast: sameStringArray(mergedCast, detail.cast) ? undefined : mergedCast,
    isFinished: detail.isFinished === undefined ? (parsed.isFinished ?? metadata?.isFinished) : undefined,
  };

  if (hasPatchChanges(patch)) {
    detail = updateAnimeDetailItem(detail.id, patch).entry;
  }

  const recordedDateString = resolveRecordedDateString(parsed);
  const shouldWriteHistory = shouldApplyProgress && Boolean(recordedDateString) && targetProgress > 0;
  const forceHistory = shouldWriteHistory && targetProgress <= detail.progress;
  const shouldRecordProgress = targetProgress > detail.progress || forceHistory;

  if (shouldRecordProgress) {
    recordAnimeProgress({
      id: detail.id,
      requestedProgress: targetProgress,
      totalEpisodes: detail.totalEpisodes,
      watchedAt: recordedDateString,
      note: QUICK_RECORD_HISTORY_NOTE,
      forceHistory,
      autoFillCompletionDate: false,
    });
    detail = loadAnimeDetailItem(detail.id) || detail;
  }

  const resolvedStatus = shouldApplyProgress
    ? (parsed.status || ((detail.totalEpisodes && targetProgress >= detail.totalEpisodes) ? "completed" : undefined))
    : undefined;
  if (resolvedStatus && resolvedStatus !== detail.status) {
    detail = updateAnimeDetailItem(detail.id, { status: resolvedStatus, autoFillCompletionDate: false }).entry;
  }

  const metadataEnriched = buildMetadataEnrichedFlag(parsed, detail);
  emitQuickRecordTrace(trace, {
    stage: "write",
    status: "success",
    title: shouldWriteHistory && targetProgress <= current.progress ? "补记完成" : "更新完成",
    detail: `${detail.title}${detail.progress > 0 ? `，当前 EP ${detail.progress}` : ""}`,
    recordTitle: parsed.animeTitle,
    matchedTitle: detail.title,
    created: false,
    replay: shouldWriteHistory && targetProgress <= current.progress,
  });
  return {
    created: false,
    replay: shouldWriteHistory && targetProgress <= current.progress,
    rewatchTag: parsed.rewatchTag,
    historyWritten: shouldWriteHistory,
    parsed,
    recognition: buildRecognition(parsed, detail, detail.progress, metadataEnriched, shouldWriteHistory, recordedDateString, detail.status),
    entry: detail,
  };
}

async function processQuickRecordIntent(
  parsed: ParsedQuickRecordIntent,
  rawText: string,
  aiSettings: AiProviderSettings,
  trace?: QuickRecordTraceReporter,
): Promise<QuickRecordResult> {
  const items = loadAnimeListItems();
  const existing = findMatchingAnime(items, parsed);
  let rewatchTag = parsed.rewatchTag || detectRewatchTag(rawText);

  emitQuickRecordTrace(trace, {
    stage: "match",
    status: "success",
    title: existing ? "已命中本地条目" : "本地未命中条目",
    detail: existing
      ? `将基于 ${existing.title} 继续处理${rewatchTag ? `，并识别为 ${rewatchTag}` : ""}`
      : "将尝试补齐元数据后新建条目",
    recordTitle: parsed.animeTitle,
    matchedTitle: existing?.title,
  });

  if (existing && !rewatchTag && shouldAutoResolveRewatch(parsed, existing)) {
    rewatchTag = resolveNextRewatchTag(findRelatedRecords(items, existing));
    emitQuickRecordTrace(trace, {
      stage: "match",
      status: "warning",
      title: "检测到重刷语义",
      detail: `当前会按 ${rewatchTag} 新建一条独立记录`,
      recordTitle: parsed.animeTitle,
      matchedTitle: existing.title,
    });
  }

  if (!existing || rewatchTag) {
    return processCreateQuickRecord(parsed, { rewatchTag, rawText, aiSettings, trace });
  }

  return processUpdateQuickRecord(parsed, existing, aiSettings, trace);
}

export async function quickRecordAnimeFromText(rawText: string, options: QuickRecordOptions = {}): Promise<QuickRecordResponse> {
  const text = rawText.trim();
  if (!text) {
    throw new Error("请输入一句话记录");
  }

  emitQuickRecordTrace(options.onTrace, {
    stage: "parse",
    status: "running",
    title: "正在解析输入",
    detail: text,
  });

  const settings = await loadSettings();
  ensureQuickRecordAiSettings(settings.ai);

  const parsedBatch = await parseQuickRecordBatch(text, settings.ai);
  if (!Array.isArray(parsedBatch.records) || parsedBatch.records.length === 0) {
    emitQuickRecordTrace(options.onTrace, {
      stage: "error",
      status: "error",
      title: "未识别到可处理的番剧",
      detail: "可以换一种描述，或者直接写番名 + 集数",
    });
    throw new Error("未能识别番剧名称，请换一种说法");
  }

  emitQuickRecordTrace(options.onTrace, {
    stage: "parse",
    status: "success",
    title: "输入解析完成",
    detail: `识别到 ${parsedBatch.records.length} 条记录：${parsedBatch.records.map((item) => item.animeTitle).join("、")}`,
  });

  const results: QuickRecordResult[] = [];
  const errors: Array<{ title: string; error: string }> = [];

  for (const parsed of parsedBatch.records) {
    try {
      results.push(await processQuickRecordIntent(parsed, text, settings.ai, options.onTrace));
    } catch (error) {
      emitQuickRecordTrace(options.onTrace, {
        stage: "error",
        status: "error",
        title: "单条记录处理失败",
        detail: `${parsed.animeTitle}：${error instanceof Error ? error.message : "处理失败"}`,
        recordTitle: parsed.animeTitle,
      });
      errors.push({
        title: parsed.animeTitle,
        error: error instanceof Error ? error.message : "处理失败",
      });
    }
  }

  if (results.length === 0) {
    throw new Error(errors[0]?.error || "AI 录入失败");
  }

  emitQuickRecordTrace(options.onTrace, {
    stage: "complete",
    status: errors.length > 0 ? "warning" : "success",
    title: errors.length > 0 ? "录入完成，但有部分失败" : "录入完成",
    detail: `成功 ${results.length} 条${errors.length > 0 ? `，失败 ${errors.length} 条` : ""}`,
  });

  const first = results[0];
  return {
    ok: true,
    count: results.length,
    createdCount: results.filter((item) => item.created).length,
    updatedCount: results.filter((item) => !item.created && !item.replay).length,
    replayCount: results.filter((item) => item.replay).length,
    historySkippedCount: results.filter((item) => !item.historyWritten).length,
    results: results.map((item) => ({
      entry: { title: item.entry.title },
      recognition: {
        matchedTitle: item.recognition.matchedTitle || undefined,
        standardTitle: item.recognition.standardTitle || undefined,
      },
    })),
    errors,
    created: first.created,
    replay: first.replay,
    rewatchTag: first.rewatchTag,
    parsed: {
      animeTitle: first.parsed.animeTitle,
      originalTitle: first.parsed.originalTitle,
    },
    recognition: {
      matchedTitle: first.recognition.matchedTitle || undefined,
      standardTitle: first.recognition.standardTitle || undefined,
      originalTitle: first.recognition.originalTitle || undefined,
      enriched: first.recognition.enriched,
      historyWritten: first.recognition.historyWritten,
    },
    entry: {
      title: first.entry.title,
      progress: first.entry.progress,
    },
  };
}