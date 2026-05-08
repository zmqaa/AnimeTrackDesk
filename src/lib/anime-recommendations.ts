import { searchAnimeMetadataCandidatesByKeyword, type AnimeMetadataSearchCandidate } from "@/lib/anime-provider";
import { stripSeasonToken, normalizeTitleToken } from "@/lib/chinese-parser";
import type { AnimeStorageEntry } from "@/src/lib/anime-store";
import { getAnimeStorageSnapshot, upsertAnimeItem } from "@/src/lib/anime-store";

const RECOMMENDATION_CACHE_KEY = "animetrack.recommendations.v1";
const RECOMMENDATION_BATCH_SIZE = 20;
const RECOMMENDATION_POOL_SIZE = 60;
const AUTO_REFRESH_MUTATION_THRESHOLD = 10;
const MAX_TAG_QUERY_COUNT = 5;
const MAX_CAST_QUERY_COUNT = 2;

interface RecommendationSourceEntryState {
  id: string;
  updatedAt: string;
}

interface RecommendationSourceState {
  entries: RecommendationSourceEntryState[];
  historyCount: number;
  latestHistoryWatchedAt?: string;
}

export interface RecommendationProfileSignal {
  label: string;
  weight: number;
}

export interface RecommendationProfile {
  topTags: RecommendationProfileSignal[];
  topCast: RecommendationProfileSignal[];
  recentKeywords: string[];
}

export interface RecommendationItem {
  id: number;
  title: string;
  originalTitle?: string;
  coverUrl?: string;
  score?: number;
  description?: string;
  premiereDate?: string;
  totalEpisodes?: number;
  durationMinutes?: number;
  tags: string[];
  isFinished?: boolean;
  matchScore: number;
  sourceQuery: string;
  reasons: string[];
}

interface RecommendationCachePayload {
  version: 1;
  generatedAt: string;
  batchIndex: number;
  staleMutationCount: number;
  sourceState: RecommendationSourceState;
  profile: RecommendationProfile;
  pool: RecommendationItem[];
}

export interface RecommendationSnapshot {
  generatedAt: string;
  batchIndex: number;
  staleMutationCount: number;
  profile: RecommendationProfile;
  items: RecommendationItem[];
  totalPoolCount: number;
  usedCache: boolean;
  autoRefreshThreshold: number;
}

type RecommendationLoadMode = "default" | "next-batch" | "refresh";

function isBrowser() {
  return typeof window !== "undefined";
}

function roundWeight(value: number) {
  return Math.round(value * 10) / 10;
}

function readCache() {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(RECOMMENDATION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as RecommendationCachePayload;
    if (parsed?.version !== 1 || !Array.isArray(parsed.pool)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload: RecommendationCachePayload) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(RECOMMENDATION_CACHE_KEY, JSON.stringify(payload));
}

function buildKnownTitleSet(entries: AnimeStorageEntry[]) {
  const knownTitles = new Set<string>();

  for (const entry of entries) {
    const candidates = [entry.title, entry.originalTitle, stripSeasonToken(entry.title), stripSeasonToken(entry.originalTitle)];
    for (const candidate of candidates) {
      const normalized = normalizeTitleToken(candidate);
      if (normalized) {
        knownTitles.add(normalized);
      }
    }
  }

  return knownTitles;
}

function buildSourceState() {
  const snapshot = getAnimeStorageSnapshot();
  const latestHistoryWatchedAt = snapshot.history
    .map((record) => record.watchedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  return {
    entries: snapshot.entries.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })),
    historyCount: snapshot.history.length,
    latestHistoryWatchedAt,
  } satisfies RecommendationSourceState;
}

function computeMutationDelta(previous: RecommendationSourceState, next: RecommendationSourceState) {
  const previousEntries = new Map(previous.entries.map((entry) => [entry.id, entry.updatedAt]));
  const nextEntries = new Map(next.entries.map((entry) => [entry.id, entry.updatedAt]));
  let delta = Math.abs(previous.historyCount - next.historyCount);

  for (const [id, updatedAt] of nextEntries) {
    const previousUpdatedAt = previousEntries.get(id);
    if (!previousUpdatedAt || previousUpdatedAt !== updatedAt) {
      delta += 1;
    }
  }

  for (const id of previousEntries.keys()) {
    if (!nextEntries.has(id)) {
      delta += 1;
    }
  }

  return delta;
}

function buildWeightedSignals(values: Iterable<[string, number]>) {
  return Array.from(values)
    .filter(([label, weight]) => Boolean(label) && weight > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([label, weight]) => ({ label, weight: roundWeight(weight) }));
}

function buildRecommendationProfile(entries: AnimeStorageEntry[]): RecommendationProfile {
  const tagWeights = new Map<string, number>();
  const castWeights = new Map<string, number>();

  for (const entry of entries) {
    const scoreWeight = entry.score > 0 ? 1 + Math.min(entry.score, 10) / 10 : 1;
    const statusWeight = entry.status === "completed"
      ? 1.8
      : entry.status === "watching"
        ? 1.4
        : entry.status === "planned"
          ? 0.8
          : 0.4;
    const recencyTimestamp = entry.lastWatchedAt || entry.updatedAt || entry.createdAt || "";
    const ageInDays = recencyTimestamp
      ? Math.max(0, (Date.now() - new Date(recencyTimestamp).getTime()) / (1000 * 60 * 60 * 24))
      : 365;
    const recencyWeight = ageInDays <= 45 ? 1.35 : ageInDays <= 120 ? 1.1 : 0.9;
    const totalWeight = scoreWeight * statusWeight * recencyWeight;

    for (const tag of entry.tags) {
      const normalizedTag = tag.trim();
      if (!normalizedTag) {
        continue;
      }

      tagWeights.set(normalizedTag, (tagWeights.get(normalizedTag) || 0) + totalWeight);
    }

    for (const castName of entry.cast ?? []) {
      const normalizedCast = castName.trim();
      if (!normalizedCast) {
        continue;
      }

      castWeights.set(normalizedCast, (castWeights.get(normalizedCast) || 0) + totalWeight * 0.55);
    }
  }

  const topTags = buildWeightedSignals(tagWeights.entries()).slice(0, 8);
  const topCast = buildWeightedSignals(castWeights.entries()).slice(0, 5);
  const recentKeywords = topTags.slice(0, 4).map((item) => item.label);

  return {
    topTags,
    topCast,
    recentKeywords,
  };
}

function buildRecommendationQueries(profile: RecommendationProfile) {
  const queries: string[] = [];
  const topTagLabels = profile.topTags.slice(0, MAX_TAG_QUERY_COUNT).map((item) => item.label);

  for (const tag of topTagLabels) {
    queries.push(tag);
  }

  for (let index = 0; index < Math.min(topTagLabels.length - 1, 3); index += 1) {
    queries.push(`${topTagLabels[index]} ${topTagLabels[index + 1]}`);
  }

  for (const cast of profile.topCast.slice(0, MAX_CAST_QUERY_COUNT)) {
    queries.push(cast.label);
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function getCandidateMatchScore(candidate: AnimeMetadataSearchCandidate, profile: RecommendationProfile) {
  const tagWeightMap = new Map(profile.topTags.map((tag) => [tag.label, tag.weight]));
  const castWeightMap = new Map(profile.topCast.map((cast) => [cast.label, cast.weight]));
  const matchedTags = (candidate.tags ?? []).filter((tag) => tagWeightMap.has(tag));
  const matchedCast = profile.topCast.filter((cast) => candidate.description?.includes(cast.label) || candidate.originalTitle?.includes(cast.label));

  let matchScore = matchedTags.reduce((total, tag) => total + (tagWeightMap.get(tag) || 0), 0);
  matchScore += matchedCast.reduce((total, cast) => total + (castWeightMap.get(cast.label) || 0) * 0.6, 0);
  matchScore += (candidate.score ?? 0) * 0.45;
  if (candidate.isFinished === false) {
    matchScore += 0.8;
  }

  const reasons: string[] = [];
  if (matchedTags.length > 0) {
    reasons.push(`命中偏好标签：${matchedTags.slice(0, 3).join("、")}`);
  }
  if (candidate.score) {
    reasons.push(`Bangumi 评分 ${candidate.score.toFixed(1)}`);
  }
  if (candidate.isFinished === false) {
    reasons.push("当前仍在放送或未完结");
  }
  if (reasons.length === 0 && candidate.tags?.length) {
    reasons.push(`标签风格接近：${candidate.tags.slice(0, 3).join("、")}`);
  }

  return {
    matchScore: roundWeight(matchScore),
    reasons: reasons.slice(0, 3),
  };
}

function isKnownCandidate(candidate: AnimeMetadataSearchCandidate, knownTitles: Set<string>) {
  const titleCandidates = [candidate.title, candidate.originalTitle, stripSeasonToken(candidate.title), stripSeasonToken(candidate.originalTitle)];
  return titleCandidates.some((title) => {
    const normalized = normalizeTitleToken(title);
    return normalized ? knownTitles.has(normalized) : false;
  });
}

function mapCandidateToRecommendationItem(
  candidate: AnimeMetadataSearchCandidate,
  sourceQuery: string,
  profile: RecommendationProfile,
) {
  const { matchScore, reasons } = getCandidateMatchScore(candidate, profile);

  return {
    id: candidate.id,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    coverUrl: candidate.coverUrl,
    score: candidate.score,
    description: candidate.description,
    premiereDate: candidate.premiereDate,
    totalEpisodes: candidate.totalEpisodes,
    durationMinutes: candidate.durationMinutes,
    tags: candidate.tags ?? [],
    isFinished: candidate.isFinished,
    matchScore,
    sourceQuery,
    reasons,
  } satisfies RecommendationItem;
}

function buildVisibleBatch(pool: RecommendationItem[], batchIndex: number) {
  if (pool.length === 0) {
    return [];
  }

  const sortedPool = [...pool].sort((left, right) => right.matchScore - left.matchScore);
  const startIndex = (batchIndex * RECOMMENDATION_BATCH_SIZE) % sortedPool.length;
  const items: RecommendationItem[] = [];

  for (let offset = 0; offset < Math.min(RECOMMENDATION_BATCH_SIZE, sortedPool.length); offset += 1) {
    items.push(sortedPool[(startIndex + offset) % sortedPool.length]);
  }

  return items;
}

async function buildRecommendationPool() {
  const snapshot = getAnimeStorageSnapshot();
  const sourceState = buildSourceState();
  const profile = buildRecommendationProfile(snapshot.entries);
  const queries = buildRecommendationQueries(profile);
  const knownTitles = buildKnownTitleSet(snapshot.entries);
  const candidateMap = new Map<number, RecommendationItem>();

  for (const query of queries) {
    const candidates = await searchAnimeMetadataCandidatesByKeyword(query);
    for (const candidate of candidates) {
      if (candidateMap.size >= RECOMMENDATION_POOL_SIZE * 2) {
        break;
      }

      if (isKnownCandidate(candidate, knownTitles)) {
        continue;
      }

      const mapped = mapCandidateToRecommendationItem(candidate, query, profile);
      if (mapped.matchScore <= 0) {
        continue;
      }

      const existing = candidateMap.get(candidate.id);
      if (!existing || existing.matchScore < mapped.matchScore) {
        candidateMap.set(candidate.id, mapped);
      }
    }
  }

  const pool = Array.from(candidateMap.values())
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, RECOMMENDATION_POOL_SIZE);

  return {
    generatedAt: new Date().toISOString(),
    sourceState,
    profile,
    pool,
  };
}

function reconcilePoolAgainstCurrentLibrary(pool: RecommendationItem[]) {
  const snapshot = getAnimeStorageSnapshot();
  const knownTitles = buildKnownTitleSet(snapshot.entries);
  return pool.filter((item) => !isKnownCandidate(item, knownTitles));
}

export async function loadAnimeRecommendations(mode: RecommendationLoadMode = "default"): Promise<RecommendationSnapshot> {
  const currentSourceState = buildSourceState();
  const cached = readCache();
  const cacheMutationDelta = cached ? computeMutationDelta(cached.sourceState, currentSourceState) : 0;
  const nextStaleMutationCount = cached ? cached.staleMutationCount + cacheMutationDelta : 0;
  const shouldRefresh = mode === "refresh"
    || !cached
    || cached.pool.length === 0
    || nextStaleMutationCount >= AUTO_REFRESH_MUTATION_THRESHOLD;

  if (shouldRefresh) {
    const generated = await buildRecommendationPool();
    const payload: RecommendationCachePayload = {
      version: 1,
      generatedAt: generated.generatedAt,
      batchIndex: 0,
      staleMutationCount: 0,
      sourceState: generated.sourceState,
      profile: generated.profile,
      pool: generated.pool,
    };
    writeCache(payload);

    return {
      generatedAt: payload.generatedAt,
      batchIndex: payload.batchIndex,
      staleMutationCount: payload.staleMutationCount,
      profile: payload.profile,
      items: buildVisibleBatch(payload.pool, payload.batchIndex),
      totalPoolCount: payload.pool.length,
      usedCache: false,
      autoRefreshThreshold: AUTO_REFRESH_MUTATION_THRESHOLD,
    };
  }

  const reconciledPool = reconcilePoolAgainstCurrentLibrary(cached.pool);
  const nextBatchIndex = mode === "next-batch"
    ? cached.batchIndex + 1
    : cached.batchIndex;
  const payload: RecommendationCachePayload = {
    ...cached,
    pool: reconciledPool,
    batchIndex: nextBatchIndex,
    staleMutationCount: nextStaleMutationCount,
    sourceState: currentSourceState,
  };
  writeCache(payload);

  return {
    generatedAt: payload.generatedAt,
    batchIndex: payload.batchIndex,
    staleMutationCount: payload.staleMutationCount,
    profile: payload.profile,
    items: buildVisibleBatch(payload.pool, payload.batchIndex),
    totalPoolCount: payload.pool.length,
    usedCache: true,
    autoRefreshThreshold: AUTO_REFRESH_MUTATION_THRESHOLD,
  };
}

export function addAnimeRecommendationToLibrary(item: RecommendationItem) {
  return upsertAnimeItem(null, {
    title: item.title,
    originalTitle: item.originalTitle,
    progress: 0,
    totalEpisodes: item.totalEpisodes,
    status: "plan_to_watch",
    score: item.score ?? null,
    notes: item.reasons.length > 0 ? `推荐加入：${item.reasons.join("；")}` : "",
    coverUrl: item.coverUrl,
    tags: item.tags,
    durationMinutes: item.durationMinutes,
    startDate: "",
    endDate: "",
    isFinished: item.isFinished ?? false,
  });
}