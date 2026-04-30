import type { QuickRecordResponse } from "@/app/anime/anime-page-helpers";
import { uniqueStrings } from "@/lib/anime-cast";
import { fetchAnimeMetadataByQueries } from "@/lib/anime-provider";
import type { AnimeDetailItem, AnimeListItem, AnimeStatus } from "@/lib/anime-shared";
import {
  appendSeasonToTitle,
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
  loadDesktopAnimeDetailItem,
  loadDesktopAnimeListItems,
  recordDesktopAnimeProgress,
  updateDesktopAnimeDetailItem,
  upsertDesktopAnimeItem,
} from "@/src/lib/desktop-anime-store";
import { loadDesktopSettings, type DesktopAiProviderSettings } from "@/src/lib/desktop-settings-store";

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

type DesktopQuickRecordResult = {
  created: boolean;
  replay: boolean;
  rewatchTag?: string;
  historyWritten: boolean;
  parsed: ParsedQuickRecordIntent;
  recognition: ReturnType<typeof buildRecognition>;
  entry: AnimeDetailItem;
};

type DesktopQuickRecordCommand = "parse_desktop_quick_record";

const QUICK_RECORD_HISTORY_NOTE = "通过桌面端 AI 录入补记了观看记录。";

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

  const baselineCount = Math.max(records.length, 1);
  return formatRewatchTag(Math.max(2, highestCount + 1, baselineCount + 1));
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

  if (parsed.status === "completed") {
    return true;
  }

  if (parsed.episode === 1 || parsed.progress === 1) {
    return true;
  }

  const hasExplicitProgress = parsed.episode !== undefined || parsed.progress !== undefined;
  return !hasExplicitProgress && (parsed.status === "watching" || parsed.status === undefined);
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

function resolveIntentStatus(parsed: ParsedQuickRecordIntent, progress: number) {
  if (parsed.status) {
    return parsed.status;
  }

  if (progress > 0) {
    return "watching" satisfies AnimeStatus;
  }

  return "plan_to_watch" satisfies AnimeStatus;
}

function resolveTargetProgress(parsed: ParsedQuickRecordIntent, currentProgress: number, totalEpisodes?: number) {
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

  return {
    records: rawRecords
      .map(normalizeQuickRecordIntent)
      .filter((item): item is ParsedQuickRecordIntent => Boolean(item)),
  };
}

async function invokeDesktopQuickRecordCommand<T>(command: DesktopQuickRecordCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function ensureDesktopQuickRecordAiSettings(value: DesktopAiProviderSettings) {
  if (!value.enabled) {
    throw new Error("请先在设置页启用 AI Provider，然后再使用 AI 录入。");
  }

  if (!value.provider.trim() || !value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) {
    throw new Error("AI 录入前，请先在设置页补齐 Provider、Base URL、模型和 API Key。");
  }
}

async function parseDesktopQuickRecordBatch(inputText: string, settings: DesktopAiProviderSettings): Promise<ParsedQuickRecordBatch> {
  const normalizedText = inputText.trim();
  if (!normalizedText) {
    return { records: [] };
  }

  const response = await invokeDesktopQuickRecordCommand<Record<string, unknown>>("parse_desktop_quick_record", {
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
    normalizeTitleToken(stripSeasonToken(item.title)),
    normalizeTitleToken(stripSeasonToken(item.originalTitle)),
  ]);
}

function findMatchingAnime(items: AnimeListItem[], parsed: ParsedQuickRecordIntent) {
  const targetTokens = uniqueStrings([
    normalizeTitleToken(parsed.animeTitle),
    normalizeTitleToken(parsed.originalTitle),
    normalizeTitleToken(stripSeasonToken(parsed.animeTitle)),
    normalizeTitleToken(stripSeasonToken(parsed.originalTitle)),
  ]);

  return items
    .filter((item) => getItemTitleTokens(item).some((token) => targetTokens.includes(token)))
    .sort((left, right) => {
      const leftWatching = left.status !== "completed";
      const rightWatching = right.status !== "completed";
      if (leftWatching !== rightWatching) {
        return leftWatching ? -1 : 1;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })[0] || null;
}

function findSameTitleRecords(items: AnimeListItem[], title: string) {
  const titleToken = normalizeTitleToken(title);
  return items.filter((item) => getItemTitleTokens(item).includes(titleToken));
}

function buildMetadataEnrichedFlag(parsed: ParsedQuickRecordIntent, detail: AnimeDetailItem) {
  return Boolean(
    (!parsed.originalTitle && detail.originalTitle)
    || (!parsed.coverUrl && detail.coverUrl)
    || (!parsed.summary && detail.summary)
    || (!parsed.totalEpisodes && detail.totalEpisodes)
    || (!(parsed.tags && parsed.tags.length > 0) && detail.tags && detail.tags.length > 0)
    || (!(parsed.cast && parsed.cast.length > 0) && detail.cast && detail.cast.length > 0)
    || (!parsed.premiereDate && detail.premiereDate)
    || (parsed.isFinished === undefined && detail.isFinished !== undefined)
  );
}

async function enrichMetadata(parsed: ParsedQuickRecordIntent) {
  try {
    return await fetchAnimeMetadataByQueries(parsed.originalTitle, parsed.animeTitle);
  } catch {
    return null;
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
  options: { rewatchTag?: string },
): Promise<DesktopQuickRecordResult> {
  const parsed = { ...parsedInput, animeTitle: parsedInput.animeTitle.trim() };
  const metadata = await enrichMetadata(parsed);
  const created = upsertDesktopAnimeItem(null, {
    title: metadata?.title || parsed.animeTitle,
    originalTitle: parsed.originalTitle || metadata?.originalTitle,
    progress: 0,
    totalEpisodes: parsed.totalEpisodes || metadata?.totalEpisodes,
    status: parsed.status === "plan_to_watch" ? "plan_to_watch" : "watching",
    notes: parsed.notes,
    coverUrl: parsed.coverUrl || metadata?.coverUrl,
    tags: uniqueStrings([...(metadata?.tags || []), ...(parsed.tags || []), options.rewatchTag]),
    durationMinutes: parsed.durationMinutes,
    startDate: undefined,
    endDate: undefined,
    isFinished: parsed.isFinished ?? metadata?.isFinished ?? false,
  });

  let entry = loadDesktopAnimeDetailItem(created.entry.id);
  if (!entry) {
    throw new Error("AI 录入后未能读取新建条目");
  }

  const createPatch = {
    summary: parsed.summary || metadata?.description,
    premiereDate: parsed.premiereDate || metadata?.premiereDate,
    cast: mergeStringArrays(metadata?.cast, parsed.cast),
  };

  if (hasPatchChanges(createPatch)) {
    entry = updateDesktopAnimeDetailItem(entry.id, createPatch).entry;
  }

  const recordedDateString = resolveRecordedDateString(parsed);
  const targetProgress = resolveCompletedProgress(
    resolveTargetProgress(parsed, 0, entry.totalEpisodes || undefined),
    parsed.status,
    entry.totalEpisodes || undefined,
  );
  const resolvedStatus = resolveIntentStatus(parsed, targetProgress);
  const shouldWriteHistory = Boolean(recordedDateString) && targetProgress > 0 && resolvedStatus !== "plan_to_watch";

  if (targetProgress > 0 || resolvedStatus === "completed") {
    recordDesktopAnimeProgress({
      id: entry.id,
      requestedProgress: targetProgress,
      totalEpisodes: entry.totalEpisodes,
      watchedAt: recordedDateString,
      note: QUICK_RECORD_HISTORY_NOTE,
      forceHistory: shouldWriteHistory,
    });
    entry = loadDesktopAnimeDetailItem(entry.id) || entry;
  }

  if (resolvedStatus !== entry.status) {
    entry = updateDesktopAnimeDetailItem(entry.id, { status: resolvedStatus }).entry;
  }

  const metadataEnriched = buildMetadataEnrichedFlag(parsed, entry);
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
): Promise<DesktopQuickRecordResult> {
  const parsed = { ...parsedInput, animeTitle: parsedInput.animeTitle.trim() };
  let detail = loadDesktopAnimeDetailItem(current.id);
  if (!detail) {
    throw new Error("未找到对应番剧");
  }

  const metadata = await enrichMetadata(parsed);
  const effectiveTotalEpisodes = parsed.totalEpisodes || detail.totalEpisodes || metadata?.totalEpisodes;
  const targetProgress = resolveCompletedProgress(
    resolveTargetProgress(parsed, detail.progress, effectiveTotalEpisodes),
    parsed.status,
    effectiveTotalEpisodes,
  );
  const mergedTags = mergeStringArrays(detail.tags, metadata?.tags, parsed.tags);
  const mergedCast = mergeStringArrays(detail.cast, metadata?.cast, parsed.cast);
  const patch = {
    originalTitle: !detail.originalTitle ? (parsed.originalTitle || metadata?.originalTitle) : undefined,
    totalEpisodes: !detail.totalEpisodes && effectiveTotalEpisodes ? effectiveTotalEpisodes : undefined,
    durationMinutes: detail.durationMinutes === undefined ? parsed.durationMinutes : undefined,
    notes: !detail.notes ? parsed.notes : undefined,
    summary: !detail.summary ? (parsed.summary || metadata?.description) : undefined,
    coverUrl: !detail.coverUrl ? (parsed.coverUrl || metadata?.coverUrl) : undefined,
    premiereDate: !detail.premiereDate ? (parsed.premiereDate || metadata?.premiereDate) : undefined,
    tags: sameStringArray(mergedTags, detail.tags) ? undefined : mergedTags,
    cast: sameStringArray(mergedCast, detail.cast) ? undefined : mergedCast,
    isFinished: detail.isFinished === undefined ? (parsed.isFinished ?? metadata?.isFinished) : undefined,
  };

  if (hasPatchChanges(patch)) {
    detail = updateDesktopAnimeDetailItem(detail.id, patch).entry;
  }

  const recordedDateString = resolveRecordedDateString(parsed);
  const shouldWriteHistory = Boolean(recordedDateString) && targetProgress > 0;
  const forceHistory = shouldWriteHistory && targetProgress <= detail.progress;
  const shouldRecordProgress = targetProgress > detail.progress || forceHistory;

  if (shouldRecordProgress) {
    recordDesktopAnimeProgress({
      id: detail.id,
      requestedProgress: targetProgress,
      totalEpisodes: detail.totalEpisodes,
      watchedAt: recordedDateString,
      note: QUICK_RECORD_HISTORY_NOTE,
      forceHistory,
    });
    detail = loadDesktopAnimeDetailItem(detail.id) || detail;
  }

  const resolvedStatus = parsed.status || ((detail.totalEpisodes && targetProgress >= detail.totalEpisodes) ? "completed" : undefined);
  if (resolvedStatus && resolvedStatus !== detail.status) {
    detail = updateDesktopAnimeDetailItem(detail.id, { status: resolvedStatus }).entry;
  }

  const metadataEnriched = buildMetadataEnrichedFlag(parsed, detail);
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

async function processDesktopQuickRecordIntent(
  parsed: ParsedQuickRecordIntent,
  rawText: string,
): Promise<DesktopQuickRecordResult> {
  const items = loadDesktopAnimeListItems();
  const existing = findMatchingAnime(items, parsed);
  let rewatchTag = parsed.rewatchTag || detectRewatchTag(rawText);

  if (existing && !rewatchTag && shouldAutoResolveRewatch(parsed, existing)) {
    rewatchTag = resolveNextRewatchTag(findSameTitleRecords(items, existing.title));
  }

  if (!existing || rewatchTag) {
    return processCreateQuickRecord(parsed, { rewatchTag });
  }

  return processUpdateQuickRecord(parsed, existing);
}

export async function quickRecordDesktopAnimeFromText(rawText: string): Promise<QuickRecordResponse> {
  const text = rawText.trim();
  if (!text) {
    throw new Error("请输入一句话记录");
  }

  const settings = await loadDesktopSettings();
  ensureDesktopQuickRecordAiSettings(settings.ai);

  const parsedBatch = await parseDesktopQuickRecordBatch(text, settings.ai);
  if (!Array.isArray(parsedBatch.records) || parsedBatch.records.length === 0) {
    throw new Error("未能识别番剧名称，请换一种说法");
  }

  const results: DesktopQuickRecordResult[] = [];
  const errors: Array<{ title: string; error: string }> = [];

  for (const parsed of parsedBatch.records) {
    try {
      results.push(await processDesktopQuickRecordIntent(parsed, text));
    } catch (error) {
      errors.push({
        title: parsed.animeTitle,
        error: error instanceof Error ? error.message : "处理失败",
      });
    }
  }

  if (results.length === 0) {
    throw new Error(errors[0]?.error || "AI 录入失败");
  }

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