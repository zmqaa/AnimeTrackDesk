import 'server-only';

import { enrichAnimeData, buildVoiceActorAliases } from './ai';
import { fetchAnimeMetadataByQueries } from './anime-provider';
import { uniqueStrings } from './anime-cast';
import type { CreateAnimeDTO } from './anime';
import metadataMergePolicy from './metadata/merge-policy.js';
import {
  toOptionalString, toOptionalNumber, toOptionalBoolean, toOptionalDateString, toStringArray,
} from './ai-validation';

type MetadataSourceInput = Partial<CreateAnimeDTO> & {
  description?: string;
  synopsis?: string;
};

const { DEFAULT_METADATA_FIELDS, applyMetadataPatch, buildMetadataCandidate } = metadataMergePolicy as unknown as {
  DEFAULT_METADATA_FIELDS: string[];
  applyMetadataPatch: (
    current: CreateAnimeDTO,
    candidateLike: MetadataSourceInput | { candidate: MetadataSourceInput; source?: Record<string, string> },
    options?: {
      fields?: string[];
      force?: boolean;
      allowReplaceFilledCover?: boolean;
      allowCastAliasAugment?: boolean;
      allowIsFinishedUpgrade?: boolean;
    }
  ) => { data: CreateAnimeDTO; patch: Partial<CreateAnimeDTO>; sources: Record<string, string> };
  buildMetadataCandidate: (
    provider?: MetadataSourceInput | null,
    ai?: MetadataSourceInput | null
  ) => { candidate: Partial<CreateAnimeDTO>; source: Record<string, string> };
};

export type AnimeEnrichmentMode = 'create' | 'fill-missing';

export interface AnimeEnrichmentOptions {
  mode?: AnimeEnrichmentMode;
  originalUserTitle?: string;
  skipVoiceActorAliases?: boolean;
  providerQueryLimit?: number;
}

function normalizeTitle(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

/** 清洗外部数据源（AI / Provider）返回值，防止脏数据入库 */
function sanitizeExternalCandidate(raw: MetadataSourceInput): MetadataSourceInput {
  return {
    ...raw,
    originalTitle: toOptionalString(raw.originalTitle)?.slice(0, 500),
    totalEpisodes: toOptionalNumber(raw.totalEpisodes),
    durationMinutes: toOptionalNumber(raw.durationMinutes),
    summary: toOptionalString(raw.summary ?? raw.description ?? raw.synopsis)?.slice(0, 10000),
    tags: toStringArray(raw.tags)?.map(t => t.slice(0, 100)).slice(0, 50),
    premiereDate: toOptionalDateString(raw.premiereDate),
    isFinished: toOptionalBoolean(raw.isFinished),
    coverUrl: toOptionalString(raw.coverUrl)?.slice(0, 2000),
  };
}

export async function enrichAnimeInput(input: CreateAnimeDTO, options: AnimeEnrichmentOptions = {}): Promise<CreateAnimeDTO> {
  const mode = options.mode || 'create';
  const originalUserTitle = (options.originalUserTitle || input.title || '').trim();
  const providerQueryLimit = Math.max(1, options.providerQueryLimit ?? 3);

  let data: CreateAnimeDTO = {
    ...input,
    tags: input.tags ? [...input.tags] : undefined,
    cast: input.cast ? [...input.cast] : undefined,
    castAliases: input.castAliases ? [...input.castAliases] : undefined,
  };

  if (!originalUserTitle) {
    return data;
  }

  let titleWasStandardized = false;
  let aiCandidate: MetadataSourceInput | null = null;
  let providerCandidate: MetadataSourceInput | null = null;

  // ── 第一步：AI 先行，拿到标准官方中文名 + 原名 ──
  try {
    const enriched = await enrichAnimeData(originalUserTitle);
    if (enriched) {
      aiCandidate = sanitizeExternalCandidate({
        originalTitle: enriched.originalTitle,
        totalEpisodes: enriched.totalEpisodes,
        durationMinutes: enriched.durationMinutes,
        summary: enriched.synopsis,
        tags: enriched.tags,
        premiereDate: enriched.premiereDate,
        isFinished: enriched.isFinished,
        coverUrl: enriched.coverUrl,
      });

      const officialTitle = normalizeTitle(enriched.officialTitle);
      if ((mode === 'create' || mode === 'fill-missing') && officialTitle) {
        titleWasStandardized = officialTitle !== originalUserTitle;
        data.title = officialTitle;
      }
    }
  } catch (error) {
    console.error('AI enrichment failed:', error);
  }

  // ── 第二步：Provider 用 AI 返回的原名搜索（精度更高）──
  // 搜索优先级：原名（日文）> AI 标准化中文名 > 用户原始输入
  const providerQueries = Array.from(new Set(
    (aiCandidate
      ? [normalizeTitle(aiCandidate.originalTitle as string), data.title, originalUserTitle]
      : [data.originalTitle, data.title, originalUserTitle])
      .map((item) => normalizeTitle(item))
      .filter((item): item is string => Boolean(item))
  )).slice(0, providerQueryLimit);

  try {
    const metadata = await fetchAnimeMetadataByQueries(...providerQueries);
    if (metadata) {
      providerCandidate = sanitizeExternalCandidate(metadata);

      const providerTitle = normalizeTitle(metadata.title);
      if ((mode === 'create' || mode === 'fill-missing') && providerTitle && providerTitle !== data.title) {
        titleWasStandardized = titleWasStandardized || providerTitle !== originalUserTitle;
        data.title = providerTitle;
      }
    }
  } catch (error) {
    console.error('Provider metadata enrichment failed:', error);
  }

  const mergedCandidate = buildMetadataCandidate(providerCandidate, aiCandidate);
  data = applyMetadataPatch(data, mergedCandidate, {
    fields: DEFAULT_METADATA_FIELDS,
    allowReplaceFilledCover: mode === 'create' && titleWasStandardized,
    allowCastAliasAugment: true,
    allowIsFinishedUpgrade: true,
  }).data;

  if (!options.skipVoiceActorAliases && Array.isArray(data.cast) && data.cast.length > 0) {
    try {
      data.castAliases = await buildVoiceActorAliases(data.cast, data.castAliases || []);
    } catch (error) {
      console.error('Voice actor alias generation failed:', error);
      data.castAliases = uniqueStrings([...(data.castAliases || []), ...data.cast]);
    }
  } else if (Array.isArray(data.cast) && data.cast.length > 0) {
    data.castAliases = uniqueStrings([...(data.castAliases || []), ...data.cast]);
  }

  return data;
}
