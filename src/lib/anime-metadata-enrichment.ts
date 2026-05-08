import { fetchAnimeMetadataByQueries } from "@/lib/anime-provider";
import type { AnimeDetailItem } from "@/lib/anime-shared";
import {
  toOptionalBoolean,
  toOptionalDateString,
  toOptionalNumber,
  toOptionalString,
  toStringArray,
} from "@/lib/ai-validation";
import type { AnimeDetailPatchInput } from "@/src/lib/anime-store";
import { loadSettings, type AiProviderSettings } from "@/src/lib/settings-store";

type AiAnimeMetadata = {
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

type AnimeMetadataPatch = Partial<AnimeDetailPatchInput> & {
  score?: number;
};

type AnimeEnrichmentCommand = "enrich_anime_metadata";

const MAX_METADATA_CAST_MEMBERS = 10;
const DEFAULT_METADATA_FIELDS = [
  "originalTitle",
  "coverUrl",
  "score",
  "totalEpisodes",
  "durationMinutes",
  "summary",
  "tags",
  "premiereDate",
  "cast",
  "castAliases",
  "isFinished",
] as const;

type MetadataField = (typeof DEFAULT_METADATA_FIELDS)[number];
type MetadataSource = "provider" | "ai";
type MetadataSourceRecord = Partial<Record<MetadataField, unknown>> & {
  synopsis?: unknown;
  description?: unknown;
};

const FIELD_SOURCE_PRIORITY: Record<MetadataField, MetadataSource[]> = {
  originalTitle: ["provider", "ai"],
  coverUrl: ["provider", "ai"],
  score: ["provider"],
  totalEpisodes: ["provider", "ai"],
  durationMinutes: ["ai", "provider"],
  summary: ["provider", "ai"],
  tags: ["ai", "provider"],
  premiereDate: ["provider", "ai"],
  cast: ["provider", "ai"],
  castAliases: ["provider", "ai"],
  isFinished: ["provider", "ai"],
};

export type AnimeEnrichmentResult = {
  patch: AnimeDetailPatchInput;
  appliedFields: string[];
  usedAi: boolean;
  usedProvider: boolean;
};

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function containsCjkText(value: unknown) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => (typeof item === "string" ? item : String(item ?? ""))));
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? uniqueStrings(parsed.map((item) => (typeof item === "string" ? item : String(item ?? ""))))
      : [];
  } catch {
    return [];
  }
}

function normalizeDateString(value: Date | string | number | null | undefined) {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return undefined;
    }

    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeMetadataDate(value: unknown) {
  if (value === null || value === undefined || value instanceof Date || typeof value === "string" || typeof value === "number") {
    return normalizeDateString(value);
  }

  return undefined;
}

function normalizeMetadataFieldValue(field: MetadataField, value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (field) {
    case "originalTitle": {
      const text = String(value).trim();
      return text || undefined;
    }
    case "coverUrl": {
      const text = String(value).trim();
      return text ? text.replace(/^http:\/\//i, "https://") : undefined;
    }
    case "summary": {
      const text = String(value).trim();
      if (!text || /无法确定|信息不足|unknown/i.test(text) || !containsCjkText(text)) {
        return undefined;
      }

      return text;
    }
    case "score": {
      const score = Number(value);
      return Number.isFinite(score) && score > 0 && score <= 10 ? Number(score.toFixed(1)) : undefined;
    }
    case "totalEpisodes":
    case "durationMinutes": {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
    }
    case "premiereDate":
      return normalizeMetadataDate(value);
    case "tags": {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, 20) : undefined;
    }
    case "cast": {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, MAX_METADATA_CAST_MEMBERS) : undefined;
    }
    case "castAliases": {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, 30) : undefined;
    }
    case "isFinished":
      return typeof value === "boolean" ? value : undefined;
    default:
      return undefined;
  }
}

function sameMetadataFieldValue(field: MetadataField, left: unknown, right: unknown) {
  switch (field) {
    case "originalTitle":
    case "coverUrl":
    case "summary":
      return String(left || "").trim() === String(right || "").trim();
    case "score":
    case "totalEpisodes":
    case "durationMinutes": {
      if (left === undefined && right === undefined) {
        return true;
      }

      const a = Number(left);
      const b = Number(right);
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001;
    }
    case "premiereDate":
      return String(normalizeMetadataDate(left) || "") === String(normalizeMetadataDate(right) || "");
    case "tags":
    case "cast":
    case "castAliases": {
      const a = uniqueStrings(Array.isArray(left) ? left : []).sort();
      const b = uniqueStrings(Array.isArray(right) ? right : []).sort();
      return a.length === b.length && a.every((value, index) => value === b[index]);
    }
    case "isFinished":
      return left === right;
    default:
      return false;
  }
}

function normalizeSourceMetadata(source?: MetadataSourceRecord | null) {
  const value = source || {};

  return {
    originalTitle: normalizeMetadataFieldValue("originalTitle", value.originalTitle),
    coverUrl: normalizeMetadataFieldValue("coverUrl", value.coverUrl),
    score: normalizeMetadataFieldValue("score", value.score),
    totalEpisodes: normalizeMetadataFieldValue("totalEpisodes", value.totalEpisodes),
    durationMinutes: normalizeMetadataFieldValue("durationMinutes", value.durationMinutes),
    summary: normalizeMetadataFieldValue("summary", value.summary ?? value.synopsis ?? value.description),
    tags: normalizeMetadataFieldValue("tags", value.tags),
    premiereDate: normalizeMetadataFieldValue("premiereDate", value.premiereDate),
    cast: normalizeMetadataFieldValue("cast", value.cast),
    castAliases: normalizeMetadataFieldValue("castAliases", value.castAliases),
    isFinished: normalizeMetadataFieldValue("isFinished", value.isFinished),
  } satisfies Partial<Record<MetadataField, unknown>>;
}

function buildMetadataCandidate(provider?: MetadataSourceRecord | null, ai?: MetadataSourceRecord | null) {
  const normalizedSources = {
    provider: normalizeSourceMetadata(provider),
    ai: normalizeSourceMetadata(ai),
  };
  const candidate: Partial<Record<MetadataField, unknown>> = {};

  for (const field of DEFAULT_METADATA_FIELDS) {
    if (field === "castAliases") {
      const providerAliases = Array.isArray(normalizedSources.provider.castAliases)
        ? normalizedSources.provider.castAliases as string[]
        : [];
      const aiAliases = Array.isArray(normalizedSources.ai.castAliases)
        ? normalizedSources.ai.castAliases as string[]
        : [];
      const mergedAliases = uniqueStrings([...providerAliases, ...aiAliases]);
      if (mergedAliases.length > 0) {
        candidate[field] = mergedAliases;
        continue;
      }
    }

    for (const sourceName of FIELD_SOURCE_PRIORITY[field]) {
      const sourceValue = normalizedSources[sourceName][field];
      if (sourceValue !== undefined) {
        candidate[field] = sourceValue;
        break;
      }
    }
  }

  return candidate;
}

function hasMissingMetadataField(current: AnimeDetailItem, field: MetadataField) {
  switch (field) {
    case "originalTitle":
    case "coverUrl":
    case "summary":
      return !String(current[field] || "").trim();
    case "score":
    case "totalEpisodes":
    case "durationMinutes": {
      const numeric = Number(current[field]);
      return !Number.isFinite(numeric) || numeric <= 0;
    }
    case "premiereDate":
      return !normalizeMetadataDate(current.premiereDate);
    case "tags":
    case "cast":
    case "castAliases":
      return !Array.isArray(current[field]) || current[field].length === 0;
    case "isFinished":
      return current.isFinished === undefined || current.isFinished === null;
    default:
      return false;
  }
}

function buildMetadataPatch(current: AnimeDetailItem, candidate: Partial<Record<MetadataField, unknown>>) {
  const patch: AnimeMetadataPatch = {};

  for (const field of DEFAULT_METADATA_FIELDS) {
    const normalizedNext = normalizeMetadataFieldValue(field, candidate[field]);
    if (normalizedNext === undefined) {
      continue;
    }

    if (hasMissingMetadataField(current, field) && !sameMetadataFieldValue(field, current[field], normalizedNext)) {
      (patch as Record<string, unknown>)[field] = normalizedNext;
    }
  }

  return patch;
}

async function invokeAnimeEnrichmentCommand<T>(
  command: AnimeEnrichmentCommand,
  args?: Record<string, unknown>,
) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function hasReadyAiSettings(settings: AiProviderSettings) {
  return settings.enabled
    && Boolean(settings.provider.trim())
    && Boolean(settings.baseUrl.trim())
    && Boolean(settings.model.trim())
    && Boolean(settings.apiKey.trim());
}

function normalizeAiMetadataPayload(value: unknown): AiAnimeMetadata | null {
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

async function fetchAiMetadata(queryName: string, settings: AiProviderSettings) {
  if (!hasReadyAiSettings(settings)) {
    return null;
  }

  const response = await invokeAnimeEnrichmentCommand<Record<string, unknown>>("enrich_anime_metadata", {
    queryName,
    settings,
  });

  return normalizeAiMetadataPayload(response);
}

function buildProviderQueries(item: AnimeDetailItem, aiMetadata: AiAnimeMetadata | null) {
  return Array.from(
    new Set(
      [
        aiMetadata?.originalTitle,
        aiMetadata?.title,
        item.originalTitle,
        item.title,
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function toAnimeDetailPatch(patch: AnimeMetadataPatch): AnimeDetailPatchInput {
  const nextPatch: AnimeDetailPatchInput = {};

  if (patch.title !== undefined) {
    nextPatch.title = patch.title;
  }
  if (patch.originalTitle !== undefined) {
    nextPatch.originalTitle = patch.originalTitle as string | null;
  }
  if (patch.score !== undefined) {
    nextPatch.score = patch.score;
  }
  if (patch.totalEpisodes !== undefined) {
    nextPatch.totalEpisodes = patch.totalEpisodes as number | null;
  }
  if (patch.durationMinutes !== undefined) {
    nextPatch.durationMinutes = patch.durationMinutes as number | null;
  }
  if (patch.summary !== undefined) {
    nextPatch.summary = patch.summary as string | null;
  }
  if (patch.coverUrl !== undefined) {
    nextPatch.coverUrl = patch.coverUrl as string | null;
  }
  if (patch.tags !== undefined) {
    nextPatch.tags = patch.tags;
  }
  if (patch.premiereDate !== undefined) {
    nextPatch.premiereDate = patch.premiereDate as string | null;
  }
  if (patch.cast !== undefined) {
    nextPatch.cast = patch.cast;
  }
  if (patch.isFinished !== undefined) {
    nextPatch.isFinished = patch.isFinished;
  }

  return nextPatch;
}

export async function enrichAnimeEntryMetadata(item: AnimeDetailItem): Promise<AnimeEnrichmentResult> {
  const settings = await loadSettings();
  const queryName = item.originalTitle?.trim() || item.title.trim();
  const aiMetadata = await fetchAiMetadata(queryName, settings.ai);
  const providerMetadata = await fetchAnimeMetadataByQueries(...buildProviderQueries(item, aiMetadata));

  const mergedCandidate = buildMetadataCandidate(providerMetadata, aiMetadata);
  const metadataPatch = buildMetadataPatch(item, mergedCandidate);

  const nextPatch: AnimeMetadataPatch = {
    ...metadataPatch,
  };

  if (item.score !== undefined && item.score !== null) {
    delete nextPatch.score;
  }

  const patch = toAnimeDetailPatch(nextPatch);
  const appliedFields = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);

  return {
    patch,
    appliedFields,
    usedAi: Boolean(aiMetadata),
    usedProvider: Boolean(providerMetadata),
  };
}