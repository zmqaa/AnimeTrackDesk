import type { AnimeRecord, WatchHistoryRecord } from "@/lib/dashboard-types";
import { getLocalTodayDateString } from "@/lib/local-date-time";
import { writeSessionCache } from "@/lib/hooks-shared";
import type { AnimeDetailItem, AnimeListItem, AnimeStatus } from "@/lib/anime-shared";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboard-shared";
import { uniqueStrings } from "@/lib/anime-cast";
import initialAnimeExport from "@/src/data/initial-anime-export.json";
import type { AnimeEntry, WatchHistoryEntry } from "../types";

export interface AnimeStorageEntry extends AnimeEntry {
  createdAt?: string;
  originalTitle?: string;
  notes?: string;
  coverUrl?: string;
  durationMinutes?: number;
  startDate?: string;
  endDate?: string;
  premiereDate?: string;
  isFinished?: boolean;
  cast?: string[];
  castAliases?: string[];
  lastWatchedAt?: string;
}

export interface AnimeStorageSnapshot {
  entries: AnimeStorageEntry[];
  history: WatchHistoryEntry[];
}

export interface AdminAnimeRecord {
  id: number;
  title: string;
  original_title: string | null;
  status: AnimeStatus;
  score: number | null;
  progress: number;
  totalEpisodes: number | null;
  createdAt: string;
}

export interface AdminHistoryRecord {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: string;
}

export interface AdminQueryOptions {
  page: number;
  pageSize: number;
  search?: string;
}

export interface AnimeUpsertInput {
  title: string;
  originalTitle?: string;
  progress: number;
  totalEpisodes?: number;
  status: AnimeStatus;
  score?: number | null;
  notes?: string;
  coverUrl?: string;
  tags: string[];
  durationMinutes?: number;
  startDate?: string;
  endDate?: string;
  isFinished: boolean;
}

export interface AnimeDetailPatchInput {
  title?: string;
  originalTitle?: string | null;
  status?: AnimeStatus;
  progress?: number;
  score?: number | null;
  totalEpisodes?: number | null;
  notes?: string | null;
  coverUrl?: string | null;
  durationMinutes?: number | null;
  tags?: string[];
  summary?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  premiereDate?: string | null;
  cast?: string[];
  isFinished?: boolean;
  autoFillCompletionDate?: boolean;
}

export interface AnimeProgressRecordInput {
  id: number;
  requestedProgress: number;
  totalEpisodes?: number | null;
  watchedAt?: string;
  note?: string;
  forceHistory?: boolean;
  autoFillCompletionDate?: boolean;
}

interface StoredAnimeEntry extends AnimeStorageEntry {}

const ENTRY_STORAGE_KEY = "animetrack.entries";
const HISTORY_STORAGE_KEY = "animetrack.history";
const BOOTSTRAP_STORAGE_KEY = "animetrack.bootstrap.complete";
const LEGACY_SEED_ENTRY_IDS = new Set(["frieren", "apothecary-diaries-s2", "witch-hat-atelier", "pluto"]);
const LEGACY_SEED_HISTORY_IDS = new Set(["h1", "h2", "h3"]);
const ANIME_LIST_CACHE_KEY = DASHBOARD_CACHE_KEYS.animeList;
const DASHBOARD_ANIME_CACHE_KEY = DASHBOARD_CACHE_KEYS.dashboardAnime;
const DASHBOARD_HISTORY_CACHE_KEY = DASHBOARD_CACHE_KEYS.dashboardHistory;

type AnimeCommand =
  | "load_anime_snapshot"
  | "save_anime_snapshot"
  | "upsert_anime_entry"
  | "save_watch_history_entry"
  | "delete_anime_entries"
  | "delete_watch_history_entries";

interface AnimeMutationInput {
  upsertEntries?: StoredAnimeEntry[];
  saveHistory?: WatchHistoryEntry[];
  deleteAnimeIds?: string[];
  deleteHistoryIds?: string[];
  replaceAll?: boolean;
}

interface BundledAnimeExportShape {
  anime?: {
    records?: unknown[];
  };
  watchHistory?: {
    records?: unknown[];
  };
}

let animeHydrationPromise: Promise<AnimeStorageSnapshot> | null = null;
let animePersistenceQueue: Promise<void> = Promise.resolve();

function hashId(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) || 1;
}

function readStoredArray<T>(storageKey: string, fallbackValue: T[]) {
  if (typeof window === "undefined") {
    return fallbackValue;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return fallbackValue;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as T[];
    return Array.isArray(parsedValue) ? parsedValue : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function hasStoredValue(storageKey: string) {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(storageKey) !== null;
}

function hasCompletedBootstrap() {
  return hasStoredValue(BOOTSTRAP_STORAGE_KEY);
}

function markBootstrapComplete() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(BOOTSTRAP_STORAGE_KEY, "1");
}

function mapStoredStatus(status: AnimeEntry["status"]): AnimeStatus {
  if (status === "planned") {
    return "plan_to_watch";
  }

  if (status === "paused") {
    return "dropped";
  }

  return status;
}

function mapUiStatus(status: AnimeStatus): AnimeEntry["status"] {
  if (status === "plan_to_watch") {
    return "planned";
  }

  if (status === "dropped") {
    return "paused";
  }

  return status;
}

function buildSeasonLabel(...dateCandidates: Array<string | undefined>) {
  const candidate = dateCandidates.find((value) => Boolean(value));
  if (!candidate) {
    return "未设定";
  }

  const parsedDate = new Date(candidate);
  if (Number.isNaN(parsedDate.getTime())) {
    return "未设定";
  }

  const month = parsedDate.getMonth() + 1;
  const season = month >= 3 && month <= 5 ? "春" : month >= 6 && month <= 8 ? "夏" : month >= 9 && month <= 11 ? "秋" : "冬";
  return `${parsedDate.getFullYear()} ${season}`;
}

function resolveSeasonLabel(currentSeason: string | undefined, ...dateCandidates: Array<string | undefined>) {
  const nextSeason = buildSeasonLabel(...dateCandidates);
  return nextSeason === "未设定" ? currentSeason || nextSeason : nextSeason;
}

function parseSeasonLabelToPremiereDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(\d{4})\s*(春|夏|秋|冬)$/);
  if (!match) {
    return undefined;
  }

  const [, year, season] = match;
  const month = season === "春" ? "03" : season === "夏" ? "06" : season === "秋" ? "09" : "01";
  return `${year}-${month}-01`;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalDate(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const parsedDate = new Date(normalized);
  return Number.isNaN(parsedDate.getTime()) ? undefined : normalized;
}

function normalizeOptionalNumber(value: number | null | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.max(0, value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeStringArrayInput(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => String(item).trim()).filter(Boolean));
  }

  if (typeof value === "string") {
    return uniqueStrings(value.split(/[|,，]/).map((item) => item.trim()).filter(Boolean));
  }

  return [];
}

function normalizeTimestamp(value: unknown, fallbackValue?: string) {
  if (typeof value === "string" && value.trim()) {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  return fallbackValue;
}

function pickLaterTimestamp(left?: string, right?: string) {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;

  if (Number.isNaN(leftTime)) {
    return right;
  }

  if (Number.isNaN(rightTime)) {
    return left;
  }

  return leftTime >= rightTime ? left : right;
}

function normalizeImportedStatus(value: unknown): AnimeEntry["status"] {
  if (value === "watching" || value === "completed") {
    return value;
  }

  if (value === "plan_to_watch" || value === "planned") {
    return "planned";
  }

  if (value === "dropped" || value === "paused") {
    return "paused";
  }

  return "planned";
}

function normalizeImportedBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeImportedNumber(value: unknown) {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function createUniqueId(candidate: string | undefined, usedIds: Set<string>, createFallback: () => string) {
  let nextId = candidate?.trim() || createFallback();

  while (usedIds.has(nextId)) {
    nextId = createFallback();
  }

  usedIds.add(nextId);
  return nextId;
}

function normalizeImportedEntry(
  value: unknown,
  fallbackTimestamp: string,
  usedIds: Set<string>,
) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";

  if (!title) {
    return null;
  }

  const sourceId = record.id === undefined || record.id === null ? undefined : String(record.id);
  const updatedAt = normalizeTimestamp(record.updatedAt, fallbackTimestamp) || fallbackTimestamp;
  const createdAt = normalizeTimestamp(record.createdAt, updatedAt) || updatedAt;
  const premiereDate = normalizeOptionalDate(typeof record.premiereDate === "string" ? record.premiereDate : undefined);
  const startDate = normalizeOptionalDate(typeof record.startDate === "string" ? record.startDate : undefined);
  const endDate = normalizeOptionalDate(typeof record.endDate === "string" ? record.endDate : undefined);
  const progress = Math.max(0, normalizeImportedNumber(record.progress) ?? 0);
  const episodes = Math.max(0, normalizeImportedNumber(record.episodes ?? record.totalEpisodes) ?? 0);

  const entry = normalizeStoredEntry({
    id: createUniqueId(sourceId, usedIds, createAnimeId),
    title,
    season: typeof record.season === "string" && record.season.trim()
      ? record.season.trim()
      : buildSeasonLabel(premiereDate, startDate, endDate, updatedAt),
    episodes,
    progress: episodes > 0 ? Math.min(progress, episodes) : progress,
    status: normalizeImportedStatus(record.status),
    score: Math.max(0, normalizeImportedNumber(record.score) ?? 0),
    tags: normalizeStringArrayInput(record.tags),
    summary: typeof record.summary === "string" ? record.summary : "",
    updatedAt,
    createdAt,
    originalTitle: typeof record.originalTitle === "string" ? record.originalTitle : undefined,
    notes: typeof record.notes === "string" ? record.notes : undefined,
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : undefined,
    durationMinutes: normalizeImportedNumber(record.durationMinutes),
    startDate,
    endDate,
    premiereDate,
    isFinished: normalizeImportedBoolean(record.isFinished),
    cast: normalizeStringArrayInput(record.cast),
    castAliases: normalizeStringArrayInput(record.castAliases),
    lastWatchedAt: normalizeTimestamp(record.lastWatchedAt, progress > 0 ? updatedAt : undefined),
  });

  return {
    entry,
    sourceId,
  };
}

function normalizeImportedHistoryRecord(
  value: unknown,
  fallbackTimestamp: string,
  usedIds: Set<string>,
  animeIdBySource: Map<string, string>,
  animeIdByTitle: Map<string, string>,
  animeTitleById: Map<string, string>,
) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const animeTitle = typeof record.animeTitle === "string" ? record.animeTitle.trim() : "";
  const sourceAnimeId = record.animeId === undefined || record.animeId === null ? undefined : String(record.animeId);
  const resolvedAnimeId = sourceAnimeId
    ? animeIdBySource.get(sourceAnimeId) || animeIdByTitle.get(animeTitle)
    : animeIdByTitle.get(animeTitle);

  if (!resolvedAnimeId) {
    return null;
  }

  const watchedAt = normalizeTimestamp(record.watchedAt, fallbackTimestamp) || fallbackTimestamp;

  return {
    id: createUniqueId(record.id === undefined || record.id === null ? undefined : String(record.id), usedIds, () => `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    animeId: resolvedAnimeId,
    animeTitle: animeTitle || animeTitleById.get(resolvedAnimeId) || "未命名番剧",
    episode: Math.max(0, normalizeImportedNumber(record.episode) ?? 0),
    watchedAt,
    note: typeof record.note === "string" ? record.note : "",
  };
}

function resolvePremiereDate(entry: StoredAnimeEntry) {
  return normalizeOptionalDate(entry.premiereDate) || parseSeasonLabelToPremiereDate(entry.season);
}

function createAnimeId() {
  return `anime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStoredEntry(entry: StoredAnimeEntry): StoredAnimeEntry {
  const premiereDate = resolvePremiereDate(entry);

  return {
    ...entry,
    episodes: Number.isFinite(entry.episodes) ? Math.max(0, entry.episodes) : 0,
    progress: Number.isFinite(entry.progress) ? Math.max(0, entry.progress) : 0,
    score: Number.isFinite(entry.score) ? Math.max(0, entry.score) : 0,
    tags: Array.isArray(entry.tags) ? uniqueStrings(entry.tags) : [],
    summary: normalizeOptionalText(entry.summary) || "",
    notes: normalizeOptionalText(entry.notes),
    createdAt: entry.createdAt || entry.updatedAt,
    originalTitle: normalizeOptionalText(entry.originalTitle),
    coverUrl: normalizeOptionalText(entry.coverUrl),
    durationMinutes: normalizeOptionalNumber(entry.durationMinutes),
    startDate: normalizeOptionalDate(entry.startDate),
    endDate: normalizeOptionalDate(entry.endDate),
    premiereDate,
    season: normalizeOptionalText(entry.season) || buildSeasonLabel(premiereDate, entry.startDate, entry.endDate, entry.updatedAt),
    cast: Array.isArray(entry.cast) ? uniqueStrings(entry.cast) : undefined,
    castAliases: Array.isArray(entry.castAliases) ? uniqueStrings(entry.castAliases) : undefined,
    lastWatchedAt: entry.lastWatchedAt || (entry.progress > 0 ? entry.updatedAt : undefined),
  };
}

function normalizeHistoryRecord(record: WatchHistoryEntry, fallbackTimestamp: string): WatchHistoryEntry {
  return {
    id: String(record.id || `history-${Math.random().toString(36).slice(2, 8)}`),
    animeId: String(record.animeId || ""),
    animeTitle: typeof record.animeTitle === "string" && record.animeTitle.trim() ? record.animeTitle.trim() : "未命名番剧",
    episode: Number.isFinite(record.episode) ? Math.max(0, record.episode) : 0,
    watchedAt: normalizeTimestamp(record.watchedAt, fallbackTimestamp) || fallbackTimestamp,
    note: typeof record.note === "string" ? record.note : "",
  };
}

function cloneStoredEntry(entry: StoredAnimeEntry): StoredAnimeEntry {
  return {
    ...entry,
    tags: [...entry.tags],
    cast: entry.cast ? [...entry.cast] : undefined,
    castAliases: entry.castAliases ? [...entry.castAliases] : undefined,
  };
}

function cloneHistoryRecord(record: WatchHistoryEntry): WatchHistoryEntry {
  return { ...record };
}

function isAnimeSnapshotShape(value: unknown): value is { entries: unknown[]; history: unknown[] } {
  return typeof value === "object" && value !== null
    && Array.isArray((value as { entries?: unknown[] }).entries)
    && Array.isArray((value as { history?: unknown[] }).history);
}

function normalizeAnimeSnapshot(snapshot: { entries: unknown[]; history: unknown[] }): AnimeStorageSnapshot {
  const fallbackTimestamp = new Date().toISOString();

  return {
    entries: snapshot.entries
      .filter((value): value is StoredAnimeEntry => Boolean(value) && typeof value === "object")
      .map((entry) => cloneStoredEntry(normalizeStoredEntry(entry))),
    history: snapshot.history
      .filter((value): value is WatchHistoryEntry => Boolean(value) && typeof value === "object")
      .map((record) => cloneHistoryRecord(normalizeHistoryRecord(record, fallbackTimestamp))),
  };
}

function normalizeImportedSnapshotData(snapshot: { entries: unknown[]; history: unknown[] }): AnimeStorageSnapshot {
  const fallbackTimestamp = new Date().toISOString();
  const usedEntryIds = new Set<string>();
  const animeIdBySource = new Map<string, string>();
  const animeIdByTitle = new Map<string, string>();
  const animeTitleById = new Map<string, string>();
  const nextEntries: StoredAnimeEntry[] = [];

  for (const record of snapshot.entries) {
    const normalizedEntry = normalizeImportedEntry(record, fallbackTimestamp, usedEntryIds);
    if (!normalizedEntry) {
      continue;
    }

    nextEntries.push(normalizedEntry.entry);
    animeIdByTitle.set(normalizedEntry.entry.title, normalizedEntry.entry.id);
    animeTitleById.set(normalizedEntry.entry.id, normalizedEntry.entry.title);

    if (normalizedEntry.sourceId) {
      animeIdBySource.set(normalizedEntry.sourceId, normalizedEntry.entry.id);
    }
  }

  const usedHistoryIds = new Set<string>();
  const nextHistory: WatchHistoryEntry[] = [];

  for (const record of snapshot.history) {
    const normalizedHistory = normalizeImportedHistoryRecord(
      record,
      fallbackTimestamp,
      usedHistoryIds,
      animeIdBySource,
      animeIdByTitle,
      animeTitleById,
    );

    if (normalizedHistory) {
      nextHistory.push(normalizedHistory);
    }
  }

  return {
    entries: nextEntries,
    history: nextHistory,
  };
}

function getBundledInitialSnapshot() {
  const bundledExport = initialAnimeExport as BundledAnimeExportShape;

  return normalizeImportedSnapshotData({
    entries: Array.isArray(bundledExport.anime?.records) ? bundledExport.anime.records : [],
    history: Array.isArray(bundledExport.watchHistory?.records) ? bundledExport.watchHistory.records : [],
  });
}

function repairMissingEpisodeCounts(snapshot: AnimeStorageSnapshot) {
  const bundledSnapshot = getBundledInitialSnapshot();
  const bundledEntryByKey = new Map<string, StoredAnimeEntry>();

  for (const entry of bundledSnapshot.entries) {
    bundledEntryByKey.set(`id:${entry.id}`, entry);
    bundledEntryByKey.set(`title:${entry.title}`, entry);

    if (entry.originalTitle) {
      bundledEntryByKey.set(`original:${entry.originalTitle}`, entry);
    }
  }

  let repairedCount = 0;
  const repairedEntries = snapshot.entries.map((entry) => {
    if (entry.episodes > 0) {
      return entry;
    }

    const bundledEntry = bundledEntryByKey.get(`id:${entry.id}`)
      || bundledEntryByKey.get(`title:${entry.title}`)
      || (entry.originalTitle ? bundledEntryByKey.get(`original:${entry.originalTitle}`) : undefined);

    if (!bundledEntry || bundledEntry.episodes <= 0) {
      return entry;
    }

    repairedCount += 1;
    return normalizeStoredEntry({
      ...entry,
      episodes: bundledEntry.episodes,
    });
  });

  return {
    snapshot: {
      entries: repairedEntries,
      history: snapshot.history,
    },
    repairedCount,
  };
}

function readLocalAnimeSnapshot() {
  return normalizeAnimeSnapshot({
    entries: readStoredArray<StoredAnimeEntry>(ENTRY_STORAGE_KEY, []),
    history: readStoredArray<WatchHistoryEntry>(HISTORY_STORAGE_KEY, []),
  });
}

function persistAnimeStateLocally(entries: StoredAnimeEntry[], history: WatchHistoryEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  const snapshot = normalizeAnimeSnapshot({ entries, history });
  window.localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(snapshot.entries));
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(snapshot.history));
  markBootstrapComplete();

  const listItems = snapshot.entries.map(buildAnimeListItem);
  writeSessionCache(ANIME_LIST_CACHE_KEY, listItems);
  writeSessionCache(DASHBOARD_ANIME_CACHE_KEY, buildDashboardAnimeRecords(snapshot.entries));
  writeSessionCache(DASHBOARD_HISTORY_CACHE_KEY, buildDashboardHistoryRecords(snapshot.entries, snapshot.history));
}

async function invokeAnimeCommand<T>(command: AnimeCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

async function loadAnimeSnapshotFromTauri() {
  const response = await invokeAnimeCommand<AnimeStorageSnapshot>("load_anime_snapshot");
  return response && isAnimeSnapshotShape(response)
    ? normalizeAnimeSnapshot(response)
    : null;
}

async function saveAnimeSnapshotToTauri(snapshot: AnimeStorageSnapshot) {
  const response = await invokeAnimeCommand<AnimeStorageSnapshot>("save_anime_snapshot", {
    snapshot,
  });

  return response && isAnimeSnapshotShape(response)
    ? normalizeAnimeSnapshot(response)
    : null;
}

function hasPersistedLocalAnimeSnapshot() {
  return hasStoredValue(ENTRY_STORAGE_KEY) || hasStoredValue(HISTORY_STORAGE_KEY);
}

function isAnimeSnapshotEmpty(snapshot: AnimeStorageSnapshot) {
  return snapshot.entries.length === 0 && snapshot.history.length === 0;
}

function shouldBootstrapBundledSnapshot(snapshot: AnimeStorageSnapshot) {
  return !hasCompletedBootstrap()
    && !hasPersistedLocalAnimeSnapshot()
    && isAnimeSnapshotEmpty(snapshot);
}

function isLegacyMockSnapshot(snapshot: AnimeStorageSnapshot) {
  return snapshot.entries.length === LEGACY_SEED_ENTRY_IDS.size
    && snapshot.history.length === LEGACY_SEED_HISTORY_IDS.size
    && snapshot.entries.every((entry) => LEGACY_SEED_ENTRY_IDS.has(entry.id))
    && snapshot.history.every((record) => LEGACY_SEED_HISTORY_IDS.has(record.id));
}

function buildAnimeListItem(entry: StoredAnimeEntry): AnimeListItem {
  return {
    id: hashId(entry.id),
    title: entry.title,
    originalTitle: entry.originalTitle || undefined,
    coverUrl: entry.coverUrl || undefined,
    status: mapStoredStatus(entry.status),
    score: entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
    totalEpisodes: entry.episodes > 0 ? entry.episodes : undefined,
    durationMinutes: entry.durationMinutes || undefined,
    notes: entry.notes || undefined,
    tags: entry.tags,
    startDate: entry.startDate || undefined,
    endDate: entry.endDate || undefined,
    isFinished: entry.isFinished,
    lastWatchedAt: entry.lastWatchedAt,
    cast: entry.cast,
    castAliases: entry.castAliases,
    createdAt: entry.createdAt || entry.updatedAt,
    updatedAt: entry.updatedAt,
  };
}

function buildAnimeDetailItem(entry: StoredAnimeEntry): AnimeDetailItem {
  return {
    ...buildAnimeListItem(entry),
    summary: entry.summary || undefined,
    premiereDate: entry.premiereDate || undefined,
  };
}

function buildDashboardAnimeRecords(entries: StoredAnimeEntry[]): AnimeRecord[] {
  return entries.map((entry) => ({
    id: hashId(entry.id),
    title: entry.title,
    originalTitle: entry.originalTitle || undefined,
    coverUrl: entry.coverUrl || undefined,
    score: entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
    totalEpisodes: entry.episodes > 0 ? entry.episodes : undefined,
    durationMinutes: entry.durationMinutes || undefined,
    status: mapStoredStatus(entry.status),
    tags: entry.tags,
    cast: entry.cast,
    castAliases: entry.castAliases,
    summary: entry.summary || undefined,
    startDate: entry.startDate || undefined,
    endDate: entry.endDate || undefined,
    premiereDate: entry.premiereDate || undefined,
    isFinished: entry.isFinished,
    createdAt: entry.createdAt || entry.updatedAt,
    updatedAt: entry.updatedAt,
    lastWatchedAt: entry.lastWatchedAt,
  }));
}

function buildDashboardHistoryRecords(entries: StoredAnimeEntry[], history: WatchHistoryEntry[]): WatchHistoryRecord[] {
  const animeIdMap = new Map(entries.map((entry) => [entry.id, hashId(entry.id)]));

  return history.map((record) => ({
    id: hashId(record.id),
    animeId: animeIdMap.get(record.animeId) ?? hashId(record.animeId),
    animeTitle: record.animeTitle,
    episode: record.episode,
    watchedAt: record.watchedAt,
  }));
}

function syncHistoryAnimeTitle(history: WatchHistoryEntry[], animeId: string, animeTitle: string) {
  return history.map((record) => (
    record.animeId === animeId && record.animeTitle !== animeTitle
      ? { ...record, animeTitle }
      : record
  ));
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const startIndex = (safePage - 1) * safePageSize;

  return items.slice(startIndex, startIndex + safePageSize);
}

function normalizeSearchQuery(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function matchesAdminAnimeSearch(entry: StoredAnimeEntry, query: string) {
  if (!query) {
    return true;
  }

  const candidates = [
    entry.title,
    entry.originalTitle,
    entry.notes,
    entry.summary,
    entry.season,
    entry.tags.join(" "),
  ];

  return candidates.some((candidate) => candidate?.toLowerCase().includes(query));
}

function matchesAdminHistorySearch(record: WatchHistoryEntry, query: string) {
  if (!query) {
    return true;
  }

  const candidates = [
    record.animeTitle,
    record.note,
    String(record.episode),
  ];

  return candidates.some((candidate) => candidate?.toLowerCase().includes(query));
}

function buildAdminAnimeRecord(entry: StoredAnimeEntry): AdminAnimeRecord {
  return {
    id: hashId(entry.id),
    title: entry.title,
    original_title: entry.originalTitle || null,
    status: mapStoredStatus(entry.status),
    score: entry.score > 0 ? entry.score : null,
    progress: entry.progress,
    totalEpisodes: entry.episodes > 0 ? entry.episodes : null,
    createdAt: entry.createdAt || entry.updatedAt,
  };
}

function buildAdminHistoryRecord(record: WatchHistoryEntry, animeIdMap: Map<string, number>): AdminHistoryRecord {
  return {
    id: hashId(record.id),
    animeId: animeIdMap.get(record.animeId) ?? hashId(record.animeId),
    animeTitle: record.animeTitle,
    episode: record.episode,
    watchedAt: record.watchedAt,
  };
}

function loadAnimeState() {
  return readLocalAnimeSnapshot();
}

function enqueueAnimePersistence(task: () => Promise<void>) {
  const nextTask = animePersistenceQueue
    .catch(() => undefined)
    .then(task);

  animePersistenceQueue = nextTask.catch(() => undefined);
  return nextTask;
}

function persistAnimeMutation(input: AnimeMutationInput) {
  const upsertEntries = input.upsertEntries ?? [];
  const saveHistory = input.saveHistory ?? [];
  const deleteHistoryIds = Array.from(new Set((input.deleteHistoryIds ?? []).filter(Boolean)));
  const deleteAnimeIds = Array.from(new Set((input.deleteAnimeIds ?? []).filter(Boolean)));

  return enqueueAnimePersistence(async () => {
    if (input.replaceAll) {
      if (deleteHistoryIds.length > 0) {
        await invokeAnimeCommand<number>("delete_watch_history_entries", { ids: deleteHistoryIds });
      }

      if (deleteAnimeIds.length > 0) {
        await invokeAnimeCommand<number>("delete_anime_entries", { ids: deleteAnimeIds });
      }
    }

    for (const entry of upsertEntries) {
      await invokeAnimeCommand<StoredAnimeEntry>("upsert_anime_entry", { entry });
    }

    for (const record of saveHistory) {
      await invokeAnimeCommand<WatchHistoryEntry>("save_watch_history_entry", { record });
    }

    if (!input.replaceAll) {
      if (deleteHistoryIds.length > 0) {
        await invokeAnimeCommand<number>("delete_watch_history_entries", { ids: deleteHistoryIds });
      }

      if (deleteAnimeIds.length > 0) {
        await invokeAnimeCommand<number>("delete_anime_entries", { ids: deleteAnimeIds });
      }
    }
  });
}

function persistAnimeMutationState(
  entries: StoredAnimeEntry[],
  history: WatchHistoryEntry[],
  input: AnimeMutationInput,
) {
  persistAnimeStateLocally(entries, history);
  return persistAnimeMutation(input);
}

function persistAnimeState(entries: StoredAnimeEntry[], history: WatchHistoryEntry[]) {
  const snapshot = normalizeAnimeSnapshot({ entries, history });
  persistAnimeStateLocally(snapshot.entries, snapshot.history);
  enqueueAnimePersistence(async () => {
    await saveAnimeSnapshotToTauri(snapshot);
  });
}

async function replaceSnapshotState(
  nextSnapshot: AnimeStorageSnapshot,
  currentSnapshot: AnimeStorageSnapshot,
) {
  await persistAnimeMutationState(nextSnapshot.entries, nextSnapshot.history, {
    replaceAll: true,
    upsertEntries: nextSnapshot.entries,
    saveHistory: nextSnapshot.history,
    deleteAnimeIds: currentSnapshot.entries.map((entry) => entry.id),
    deleteHistoryIds: currentSnapshot.history.map((record) => record.id),
  });

  return nextSnapshot;
}

export function getCachedAnimeStorageSnapshot() {
  return normalizeAnimeSnapshot(readLocalAnimeSnapshot());
}

export async function hydrateAnimeStore() {
  if (animeHydrationPromise) {
    return animeHydrationPromise;
  }

  animeHydrationPromise = (async () => {
    const cachedSnapshot = getCachedAnimeStorageSnapshot();
    const tauriSnapshot = await loadAnimeSnapshotFromTauri();

    if (!tauriSnapshot) {
      const nextSnapshot = shouldBootstrapBundledSnapshot(cachedSnapshot) || isLegacyMockSnapshot(cachedSnapshot)
        ? getBundledInitialSnapshot()
        : cachedSnapshot;
      const repairedSnapshot = repairMissingEpisodeCounts(nextSnapshot);
      persistAnimeStateLocally(repairedSnapshot.snapshot.entries, repairedSnapshot.snapshot.history);
      return repairedSnapshot.snapshot;
    }

    if (isAnimeSnapshotEmpty(tauriSnapshot)) {
      const nextSnapshot = shouldBootstrapBundledSnapshot(cachedSnapshot) || isLegacyMockSnapshot(cachedSnapshot)
        ? getBundledInitialSnapshot()
        : cachedSnapshot;
      const resolvedSnapshot = await replaceSnapshotState(nextSnapshot, tauriSnapshot);
      const repairedSnapshot = repairMissingEpisodeCounts(resolvedSnapshot);
      persistAnimeStateLocally(repairedSnapshot.snapshot.entries, repairedSnapshot.snapshot.history);
      return repairedSnapshot.snapshot;
    }

    const repairedSnapshot = repairMissingEpisodeCounts(tauriSnapshot);
    persistAnimeStateLocally(repairedSnapshot.snapshot.entries, repairedSnapshot.snapshot.history);
    return repairedSnapshot.snapshot;
  })();

  return animeHydrationPromise;
}

function findEntryIndex(entries: StoredAnimeEntry[], id: number) {
  return entries.findIndex((entry) => hashId(entry.id) === id);
}

function resolveStatusForProgress(currentStatus: AnimeStatus, progress: number, totalEpisodes?: number) {
  if (totalEpisodes && progress >= totalEpisodes) {
    return "completed" satisfies AnimeStatus;
  }

  if (progress <= 0) {
    return currentStatus === "completed" ? "plan_to_watch" : currentStatus;
  }

  if (currentStatus === "completed" && !totalEpisodes) {
    return "completed" satisfies AnimeStatus;
  }

  if (currentStatus === "plan_to_watch" || currentStatus === "dropped") {
    return "watching" satisfies AnimeStatus;
  }

  if (currentStatus === "completed") {
    return "watching" satisfies AnimeStatus;
  }

  return currentStatus;
}

export function loadAnimeListItems() {
  return loadAnimeState().entries.map(buildAnimeListItem);
}

export function loadDashboardAnimeRecords() {
  return buildDashboardAnimeRecords(loadAnimeState().entries);
}

export function loadAdminAnimeRecords(options: AdminQueryOptions) {
  const { entries } = loadAnimeState();
  const searchQuery = normalizeSearchQuery(options.search);
  const filteredEntries = entries
    .filter((entry) => matchesAdminAnimeSearch(entry, searchQuery))
    .sort((left, right) => {
      const createdDiff = new Date(right.createdAt || right.updatedAt).getTime() - new Date(left.createdAt || left.updatedAt).getTime();
      if (createdDiff !== 0) {
        return createdDiff;
      }

      return left.title.localeCompare(right.title, "zh-CN");
    });

  return {
    total: filteredEntries.length,
    records: paginateItems(filteredEntries, options.page, options.pageSize).map(buildAdminAnimeRecord),
  };
}

export function loadAdminHistoryRecords(options: AdminQueryOptions) {
  const { entries, history } = loadAnimeState();
  const searchQuery = normalizeSearchQuery(options.search);
  const animeIdMap = new Map(entries.map((entry) => [entry.id, hashId(entry.id)]));
  const filteredHistory = history
    .filter((record) => matchesAdminHistorySearch(record, searchQuery))
    .sort((left, right) => new Date(right.watchedAt).getTime() - new Date(left.watchedAt).getTime());

  return {
    total: filteredHistory.length,
    records: paginateItems(filteredHistory, options.page, options.pageSize).map((record) => buildAdminHistoryRecord(record, animeIdMap)),
  };
}

export function getAnimeStorageSnapshot(): AnimeStorageSnapshot {
  return getCachedAnimeStorageSnapshot();
}

export async function replaceAnimeStorageSnapshot(snapshot: {
  entries: unknown[];
  history: unknown[];
}) {
  if (!Array.isArray(snapshot.entries) || !Array.isArray(snapshot.history)) {
    throw new Error("导入文件格式无效");
  }

  const currentSnapshot = loadAnimeState();
  const fallbackTimestamp = new Date().toISOString();
  const usedEntryIds = new Set<string>();
  const animeIdBySource = new Map<string, string>();
  const animeIdByTitle = new Map<string, string>();
  const animeTitleById = new Map<string, string>();
  const nextEntries: StoredAnimeEntry[] = [];

  for (const record of snapshot.entries) {
    const normalizedEntry = normalizeImportedEntry(record, fallbackTimestamp, usedEntryIds);
    if (!normalizedEntry) {
      continue;
    }

    nextEntries.push(normalizedEntry.entry);
    animeIdByTitle.set(normalizedEntry.entry.title, normalizedEntry.entry.id);
    animeTitleById.set(normalizedEntry.entry.id, normalizedEntry.entry.title);

    if (normalizedEntry.sourceId) {
      animeIdBySource.set(normalizedEntry.sourceId, normalizedEntry.entry.id);
    }
  }

  const usedHistoryIds = new Set<string>();
  const nextHistory: WatchHistoryEntry[] = [];

  for (const record of snapshot.history) {
    const normalizedHistory = normalizeImportedHistoryRecord(
      record,
      fallbackTimestamp,
      usedHistoryIds,
      animeIdBySource,
      animeIdByTitle,
      animeTitleById,
    );

    if (normalizedHistory) {
      nextHistory.push(normalizedHistory);
    }
  }

  await replaceSnapshotState({ entries: nextEntries, history: nextHistory }, currentSnapshot);

  return {
    animeCount: nextEntries.length,
    historyCount: nextHistory.length,
  };
}

export function loadAnimeDetailItem(id: number) {
  const entry = loadAnimeState().entries.find((item) => hashId(item.id) === id);
  return entry ? buildAnimeDetailItem(entry) : null;
}

export function loadWatchHistoryRecords() {
  const { entries, history } = loadAnimeState();

  return buildDashboardHistoryRecords(entries, history).sort(
    (left, right) => new Date(right.watchedAt).getTime() - new Date(left.watchedAt).getTime(),
  );
}

export function upsertAnimeItem(editingId: number | null, input: AnimeUpsertInput) {
  const { entries, history } = loadAnimeState();
  const now = new Date().toISOString();
  const existingIndex = editingId === null ? -1 : findEntryIndex(entries, editingId);
  const existingEntry = existingIndex >= 0 ? entries[existingIndex] : null;
  const nextStartDate = normalizeOptionalDate(input.startDate);
  const rawEndDate = normalizeOptionalDate(input.endDate);
  const nextEpisodes = Math.max(0, input.totalEpisodes || 0);
  const nextProgress = nextEpisodes > 0 ? Math.min(Math.max(0, input.progress), nextEpisodes) : Math.max(0, input.progress);
  const normalizedStatus = resolveStatusForProgress(input.status, nextProgress, nextEpisodes || undefined);
  const nextEndDate = normalizedStatus === "completed"
    ? rawEndDate || existingEntry?.endDate || getLocalTodayDateString(now)
    : rawEndDate;

  const nextEntry = normalizeStoredEntry({
    id: existingEntry?.id || createAnimeId(),
    title: input.title.trim(),
    originalTitle: normalizeOptionalText(input.originalTitle),
    season: existingEntry
      ? resolveSeasonLabel(existingEntry.season, existingEntry.premiereDate, nextStartDate, nextEndDate)
      : buildSeasonLabel(nextStartDate, nextEndDate, now),
    episodes: nextEpisodes,
    progress: nextProgress,
    status: mapUiStatus(normalizedStatus),
    score: input.score === undefined ? (existingEntry?.score || 0) : Math.max(0, input.score ?? 0),
    tags: uniqueStrings(input.tags),
    summary: existingEntry?.summary || "",
    notes: normalizeOptionalText(input.notes),
    updatedAt: now,
    createdAt: existingEntry?.createdAt || now,
    coverUrl: normalizeOptionalText(input.coverUrl),
    durationMinutes: normalizeOptionalNumber(input.durationMinutes),
    startDate: nextStartDate,
    endDate: nextEndDate,
    premiereDate: existingEntry?.premiereDate,
    isFinished: input.isFinished,
    cast: existingEntry?.cast,
    castAliases: existingEntry?.castAliases,
    lastWatchedAt: nextProgress > 0 ? existingEntry?.lastWatchedAt || now : existingEntry?.lastWatchedAt,
  });

  const nextEntries = existingIndex >= 0
    ? entries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
    : [nextEntry, ...entries];
  const nextHistory = existingEntry ? syncHistoryAnimeTitle(history, existingEntry.id, nextEntry.title) : history;

  persistAnimeMutationState(nextEntries, nextHistory, {
    upsertEntries: [nextEntry],
  });

  return {
    items: nextEntries.map(buildAnimeListItem),
    entry: buildAnimeListItem(nextEntry),
  };
}

export function updateAnimeDetailItem(id: number, input: AnimeDetailPatchInput) {
  const { entries, history } = loadAnimeState();
  const entryIndex = findEntryIndex(entries, id);

  if (entryIndex < 0) {
    throw new Error("未找到对应番剧");
  }

  const existingEntry = entries[entryIndex];
  const now = new Date().toISOString();
  const nextTitle = input.title === undefined ? existingEntry.title : input.title.trim() || existingEntry.title;
  const nextEpisodes = input.totalEpisodes === undefined
    ? existingEntry.episodes
    : Math.max(0, input.totalEpisodes ?? 0);
  const requestedProgress = input.progress === undefined
    ? existingEntry.progress
    : Math.max(0, input.progress);
  const nextProgress = nextEpisodes > 0 ? Math.min(requestedProgress, nextEpisodes) : requestedProgress;
  const previousStatus = mapStoredStatus(existingEntry.status);
  const nextStatus = resolveStatusForProgress(input.status ?? mapStoredStatus(existingEntry.status), nextProgress, nextEpisodes || undefined);
  const nextStartDate = input.startDate === undefined ? existingEntry.startDate : normalizeOptionalDate(input.startDate);
  const nextPremiereDate = input.premiereDate === undefined ? existingEntry.premiereDate : normalizeOptionalDate(input.premiereDate);
  const hasExplicitEndDate = input.endDate !== undefined;
  const rawEndDate = hasExplicitEndDate ? normalizeOptionalDate(input.endDate) : existingEntry.endDate;
  const completedNow = nextStatus === "completed" && previousStatus !== "completed";
  const autoFillCompletionDate = input.autoFillCompletionDate !== false;
  const nextEndDate = nextStatus === "completed"
    ? (hasExplicitEndDate ? rawEndDate : (completedNow && autoFillCompletionDate ? (rawEndDate || getLocalTodayDateString(now)) : rawEndDate))
    : rawEndDate;

  const nextEntry = normalizeStoredEntry({
    ...existingEntry,
    title: nextTitle,
    originalTitle: input.originalTitle === undefined ? existingEntry.originalTitle : normalizeOptionalText(input.originalTitle),
    season: resolveSeasonLabel(existingEntry.season, nextPremiereDate, nextStartDate, nextEndDate),
    episodes: nextEpisodes,
    progress: nextProgress,
    status: mapUiStatus(nextStatus),
    score: input.score === undefined ? existingEntry.score : Math.max(0, input.score ?? 0),
    tags: input.tags === undefined ? existingEntry.tags : uniqueStrings(input.tags),
    summary: input.summary === undefined ? existingEntry.summary : normalizeOptionalText(input.summary) || "",
    notes: input.notes === undefined ? existingEntry.notes : normalizeOptionalText(input.notes),
    updatedAt: now,
    createdAt: existingEntry.createdAt || existingEntry.updatedAt,
    coverUrl: input.coverUrl === undefined ? existingEntry.coverUrl : normalizeOptionalText(input.coverUrl),
    durationMinutes: input.durationMinutes === undefined ? existingEntry.durationMinutes : normalizeOptionalNumber(input.durationMinutes),
    startDate: nextStartDate,
    endDate: nextEndDate,
    premiereDate: nextPremiereDate,
    isFinished: input.isFinished === undefined ? existingEntry.isFinished : input.isFinished,
    cast: input.cast === undefined ? existingEntry.cast : uniqueStrings(input.cast),
    lastWatchedAt: nextProgress > existingEntry.progress ? now : existingEntry.lastWatchedAt,
  });

  const nextEntries = entries.map((entry, index) => (index === entryIndex ? nextEntry : entry));
  const syncedHistory = syncHistoryAnimeTitle(history, existingEntry.id, nextEntry.title);
  const nextHistory = nextProgress > existingEntry.progress
    ? [
        {
          id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          animeId: existingEntry.id,
          animeTitle: nextEntry.title,
          episode: nextProgress,
          watchedAt: now,
          note: "通过桌面端详情页更新了观看进度。",
        },
        ...syncedHistory,
      ]
    : syncedHistory;
  const createdHistory = nextProgress > existingEntry.progress ? nextHistory[0] : null;

  persistAnimeMutationState(nextEntries, nextHistory, {
    upsertEntries: [nextEntry],
    saveHistory: createdHistory ? [createdHistory] : [],
  });

  return {
    items: nextEntries.map(buildAnimeListItem),
    entry: buildAnimeDetailItem(nextEntry),
  };
}

export function updateAnimeProgress(id: number, requestedProgress: number, totalEpisodes?: number | null) {
  return recordAnimeProgress({
    id,
    requestedProgress,
    totalEpisodes,
  });
}

export function recordAnimeProgress(input: AnimeProgressRecordInput) {
  const { entries, history } = loadAnimeState();
  const entryIndex = findEntryIndex(entries, input.id);

  if (entryIndex < 0) {
    throw new Error("未找到对应番剧");
  }

  const existingEntry = entries[entryIndex];
  const maxEpisodes = input.totalEpisodes || existingEntry.episodes || undefined;
  const nextProgress = maxEpisodes
    ? Math.min(Math.max(input.requestedProgress, 0), maxEpisodes)
    : Math.max(input.requestedProgress, 0);
  const now = new Date().toISOString();
  const watchedAt = normalizeTimestamp(input.watchedAt, now) || now;
  const nextStatus = resolveStatusForProgress(mapStoredStatus(existingEntry.status), nextProgress, maxEpisodes);
  const completedNow = nextStatus === "completed" && mapStoredStatus(existingEntry.status) !== "completed";
  const shouldWriteHistory = (nextProgress > existingEntry.progress || Boolean(input.forceHistory)) && nextProgress > 0;
  const autoFillCompletionDate = input.autoFillCompletionDate !== false;

  const nextEntry: StoredAnimeEntry = {
    ...existingEntry,
    progress: nextProgress,
    episodes: maxEpisodes || existingEntry.episodes,
    status: mapUiStatus(nextStatus),
    updatedAt: now,
    lastWatchedAt: shouldWriteHistory ? pickLaterTimestamp(existingEntry.lastWatchedAt, watchedAt) : existingEntry.lastWatchedAt,
    endDate: nextStatus === "completed"
      ? (existingEntry.endDate || (autoFillCompletionDate ? getLocalTodayDateString(now) : undefined))
      : existingEntry.endDate,
  };

  const nextEntries = entries.map((entry, index) => (index === entryIndex ? nextEntry : entry));
  const nextHistory = shouldWriteHistory
    ? [
        {
          id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          animeId: existingEntry.id,
          animeTitle: existingEntry.title,
          episode: nextProgress,
          watchedAt,
          note: input.note || (completedNow ? "通过桌面端记录为已看完。" : "通过桌面端更新了观看进度。"),
        },
        ...history,
      ]
    : history;
  const createdHistory = shouldWriteHistory ? nextHistory[0] : null;

  persistAnimeMutationState(nextEntries, nextHistory, {
    upsertEntries: [nextEntry],
    saveHistory: createdHistory ? [createdHistory] : [],
  });

  return {
    items: nextEntries.map(buildAnimeListItem),
    entry: buildAnimeListItem(nextEntry),
    completedNow,
  };
}

export function deleteAnimeItem(id: number) {
  const { entries, history } = loadAnimeState();
  const entryIndex = findEntryIndex(entries, id);

  if (entryIndex < 0) {
    throw new Error("未找到对应番剧");
  }

  const removedEntry = entries[entryIndex];
  const nextEntries = entries.filter((_, index) => index !== entryIndex);
  const nextHistory = history.filter((record) => record.animeId !== removedEntry.id);

  persistAnimeMutationState(nextEntries, nextHistory, {
    deleteAnimeIds: [removedEntry.id],
  });

  return {
    items: nextEntries.map(buildAnimeListItem),
  };
}

export function deleteAnimeItems(ids: number[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return { deleted: 0 };
  }

  const { entries, history } = loadAnimeState();
  const idsToDelete = new Set(uniqueIds);
  const removedEntryIds = new Set(
    entries
      .filter((entry) => idsToDelete.has(hashId(entry.id)))
      .map((entry) => entry.id),
  );

  if (removedEntryIds.size === 0) {
    throw new Error("未找到对应番剧");
  }

  const nextEntries = entries.filter((entry) => !removedEntryIds.has(entry.id));
  const nextHistory = history.filter((record) => !removedEntryIds.has(record.animeId));

  persistAnimeMutationState(nextEntries, nextHistory, {
    deleteAnimeIds: Array.from(removedEntryIds),
  });

  return {
    deleted: removedEntryIds.size,
  };
}

export function deleteWatchHistoryItems(ids: number[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return { deleted: 0 };
  }

  const { entries, history } = loadAnimeState();
  const idsToDelete = new Set(uniqueIds);
  const removedHistoryIds = history
    .filter((record) => idsToDelete.has(hashId(record.id)))
    .map((record) => record.id);
  const removedHistoryIdSet = new Set(removedHistoryIds);
  const nextHistory = history.filter((record) => !removedHistoryIdSet.has(record.id));
  const deletedCount = removedHistoryIds.length;

  if (deletedCount === 0) {
    throw new Error("未找到对应历史记录");
  }

  persistAnimeMutationState(entries, nextHistory, {
    deleteHistoryIds: removedHistoryIds,
  });

  return {
    deleted: deletedCount,
  };
}
