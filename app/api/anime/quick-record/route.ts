import { NextRequest } from 'next/server';
import { createAnimeRecord, findAnimeByTitle, updateAnimeRecord, CreateAnimeDTO, listAnimeRecordsByExactTitle, AnimeRecord } from '@/lib/anime';
import { addBatchWatchHistory, addWatchHistory } from '@/lib/history';
import { parseQuickRecordBatch, type ParsedQuickRecordIntent } from '@/lib/ai';
import { enrichAnimeInput } from '@/lib/anime-enrichment';
import { apiError, apiSuccess, requireAdmin } from '@/lib/api-response';
import metadataMergePolicy from '@/lib/metadata/merge-policy.js';
import {
  detectRewatchTag, resolveNextRewatchTag, shouldAutoResolveRewatch,
  normalizeDate, resolveRecordedDateString, resolveIntentStatus, resolveTargetProgress,
  mergeStringArrays, sameStringArray, hasPatchChanges, buildRecognition,
} from './_helpers';

type QuickRecordResult = {
  created: boolean;
  replay: boolean;
  rewatchTag?: string;
  historyWritten: boolean;
  parsed: ParsedQuickRecordIntent;
  recognition: ReturnType<typeof buildRecognition>;
  entry: AnimeRecord;
};

const { DEFAULT_METADATA_FIELDS, buildMetadataPatch } = metadataMergePolicy as unknown as {
  DEFAULT_METADATA_FIELDS: string[];
  buildMetadataPatch: (
    current: Partial<CreateAnimeDTO>,
    candidateLike: Partial<CreateAnimeDTO> | { candidate: Partial<CreateAnimeDTO>; source?: Record<string, string> },
    options?: {
      fields?: string[];
      force?: boolean;
      allowReplaceFilledCover?: boolean;
      allowCastAliasAugment?: boolean;
      allowIsFinishedUpgrade?: boolean;
    }
  ) => { patch: Partial<CreateAnimeDTO>; sources: Record<string, string> };
};

function toAnimeInput(record: AnimeRecord): CreateAnimeDTO {
  return {
    title: record.title,
    originalTitle: record.originalTitle,
    coverUrl: record.coverUrl,
    status: record.status,
    score: record.score,
    progress: record.progress,
    totalEpisodes: record.totalEpisodes,
    durationMinutes: record.durationMinutes,
    notes: record.notes,
    tags: record.tags,
    cast: record.cast,
    castAliases: record.castAliases,
    summary: record.summary,
    startDate: record.startDate,
    endDate: record.endDate,
    premiereDate: record.premiereDate,
    isFinished: record.isFinished,
  };
}

async function processQuickRecordIntent(
  parsedInput: ParsedQuickRecordIntent,
  options: { rawText: string; manualRewatchTag?: string; forceRewatch?: boolean },
): Promise<QuickRecordResult> {
  const parsed: ParsedQuickRecordIntent = {
    ...parsedInput,
    animeTitle: parsedInput.animeTitle.trim(),
    premiereDate: undefined,
  };

  const recordedDateString = resolveRecordedDateString(parsed);
  const watchedAt = normalizeDate(recordedDateString);
  let rewatchTag = parsed.rewatchTag || options.manualRewatchTag || detectRewatchTag(options.rawText) || (options.forceRewatch ? '二刷' : undefined);

  const anime = await findAnimeByTitle(parsed.animeTitle);
  const sameTitleRecords = anime ? await listAnimeRecordsByExactTitle(anime.title) : [];

  if (!rewatchTag && anime && shouldAutoResolveRewatch(parsed, anime)) {
    rewatchTag = resolveNextRewatchTag(sameTitleRecords);
  }

  const forceCreateDuplicate = Boolean(rewatchTag);

  // ── 新建 ──
  if (!anime || forceCreateDuplicate) {
    let input: CreateAnimeDTO = {
      title: anime?.title || parsed.animeTitle,
      originalTitle: parsed.originalTitle || anime?.originalTitle,
      coverUrl: parsed.coverUrl || anime?.coverUrl,
      status: parsed.status || 'watching',
      score: parsed.score ?? anime?.score,
      progress: 0,
      totalEpisodes: parsed.totalEpisodes || anime?.totalEpisodes,
      durationMinutes: parsed.durationMinutes || anime?.durationMinutes,
      notes: parsed.notes || anime?.notes,
      tags: mergeStringArrays(anime?.tags, parsed.tags),
      cast: parsed.cast && parsed.cast.length > 0 ? parsed.cast : anime?.cast,
      castAliases: mergeStringArrays(anime?.castAliases, parsed.castAliases, parsed.cast),
      summary: parsed.summary || anime?.summary,
      startDate: undefined,
      endDate: undefined,
      premiereDate: anime?.premiereDate,
      isFinished: parsed.isFinished ?? anime?.isFinished,
    };

    if (!anime) {
      input = await enrichAnimeInput(input, {
        mode: 'create',
        originalUserTitle: parsed.originalTitle || parsed.animeTitle,
        skipVoiceActorAliases: true,
        providerQueryLimit: 2,
      });
    }

    const metadataEnriched = !anime && Boolean(
      (!parsed.originalTitle && input.originalTitle) ||
      (!parsed.coverUrl && input.coverUrl) ||
      (!parsed.summary && input.summary) ||
      (!parsed.totalEpisodes && input.totalEpisodes) ||
      (!parsed.durationMinutes && input.durationMinutes) ||
      (!(parsed.tags && parsed.tags.length > 0) && input.tags && input.tags.length > 0) ||
      (!(parsed.cast && parsed.cast.length > 0) && input.cast && input.cast.length > 0) ||
      (!parsed.premiereDate && input.premiereDate) ||
      (parsed.isFinished === undefined && input.isFinished !== undefined)
    );

    if (rewatchTag) {
      input.tags = mergeStringArrays(input.tags, [rewatchTag]);
    }

    const targetProgress = resolveTargetProgress(parsed, 0, input.totalEpisodes);
    input.progress = targetProgress;
    input.status = resolveIntentStatus(parsed, targetProgress);

    if (input.status === 'completed' && input.totalEpisodes) {
      input.progress = input.totalEpisodes;
    } else if (input.status === 'completed' && input.progress === 0) {
      input.progress = 1;
    }

    const created = await createAnimeRecord(input);
    const shouldWriteHistory = Boolean(recordedDateString) && created.progress > 0 && created.status !== 'plan_to_watch';
    if (shouldWriteHistory) {
      await addWatchHistory(created.id, created.title, created.progress, watchedAt);
    }

    const entry = created;
    return {
      created: true, replay: false, rewatchTag, historyWritten: shouldWriteHistory, parsed,
      recognition: buildRecognition(parsed, entry, entry.progress, metadataEnriched, shouldWriteHistory, recordedDateString, entry.status),
      entry,
    };
  }

  // ── 更新已有作品 ──
  const enriched = await enrichAnimeInput(toAnimeInput(anime), {
    mode: 'fill-missing',
    originalUserTitle: parsed.originalTitle || parsed.animeTitle || anime.originalTitle || anime.title,
    skipVoiceActorAliases: true,
    providerQueryLimit: 2,
  });
  const metadataPatch = buildMetadataPatch(anime, enriched, {
    fields: DEFAULT_METADATA_FIELDS,
    allowCastAliasAugment: true,
    allowIsFinishedUpgrade: true,
  }).patch;
  const effectiveTotalEpisodes = parsed.totalEpisodes || enriched.totalEpisodes || anime.totalEpisodes;
  const targetProgress = resolveTargetProgress(parsed, anime.progress, effectiveTotalEpisodes);
  const mergedTags = mergeStringArrays(
    anime.tags,
    Array.isArray(metadataPatch.tags) ? metadataPatch.tags : undefined,
    parsed.tags,
    rewatchTag ? [rewatchTag] : undefined,
  );
  const mergedCast = mergeStringArrays(
    anime.cast,
    Array.isArray(metadataPatch.cast) ? metadataPatch.cast : undefined,
    parsed.cast,
  );
  const mergedCastAliases = mergeStringArrays(
    anime.castAliases,
    Array.isArray(metadataPatch.castAliases) ? metadataPatch.castAliases : undefined,
    parsed.castAliases,
    parsed.cast,
    mergedCast,
  );
  const patch: Partial<CreateAnimeDTO> = { ...metadataPatch };
  const metadataEnriched = Object.keys(metadataPatch).length > 0;

  if (parsed.originalTitle && !anime.originalTitle) patch.originalTitle = parsed.originalTitle;
  if (parsed.score !== undefined && anime.score === undefined) patch.score = parsed.score;
  if (parsed.totalEpisodes && !anime.totalEpisodes) patch.totalEpisodes = parsed.totalEpisodes;
  if (parsed.durationMinutes && !anime.durationMinutes) patch.durationMinutes = parsed.durationMinutes;
  if (parsed.notes && !anime.notes) patch.notes = parsed.notes;
  if (parsed.summary && !anime.summary) patch.summary = parsed.summary;
  if (parsed.coverUrl && !anime.coverUrl) patch.coverUrl = parsed.coverUrl;
  if (!sameStringArray(mergedCast, anime.cast)) patch.cast = mergedCast;
  if (!sameStringArray(mergedTags, anime.tags)) patch.tags = mergedTags;
  if (!sameStringArray(mergedCastAliases, anime.castAliases)) patch.castAliases = mergedCastAliases;
  if (parsed.isFinished !== undefined && anime.isFinished === undefined) patch.isFinished = parsed.isFinished;
  if (targetProgress > anime.progress) patch.progress = targetProgress;

  const resolvedStatus = parsed.status || ((effectiveTotalEpisodes && targetProgress >= effectiveTotalEpisodes) ? 'completed' : undefined);
  if (resolvedStatus && resolvedStatus !== anime.status) patch.status = resolvedStatus;

  let entry = anime;
  if (hasPatchChanges(patch)) {
    const updated = await updateAnimeRecord(anime.id, patch);
    if (!updated) throw new Error('更新失败');
    entry = updated;
  }

  let historyWritten = false;
  const shouldWriteHistory = Boolean(recordedDateString) && targetProgress > 0;
  if (shouldWriteHistory) {
    if (targetProgress > anime.progress) {
      await addBatchWatchHistory(entry.id, entry.title, anime.progress + 1, targetProgress, watchedAt);
      historyWritten = true;
    } else if (parsed.episode !== undefined || parsed.progress !== undefined || parsed.status === 'watching' || parsed.status === 'completed') {
      await addWatchHistory(entry.id, entry.title, targetProgress, watchedAt);
      historyWritten = true;
    }
  }

  const finalEntry = entry;
  return {
    created: false, replay: historyWritten && targetProgress <= anime.progress, rewatchTag, historyWritten, parsed,
    recognition: buildRecognition(parsed, finalEntry, finalEntry.progress, metadataEnriched, historyWritten, recordedDateString, finalEntry.status),
    entry: finalEntry,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin('只有管理员可以使用 AI 录入');
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return apiError('请输入一句话记录', 400);
    }

    const parsedBatch = await parseQuickRecordBatch(text);
    if (!Array.isArray(parsedBatch.records) || parsedBatch.records.length === 0) {
      return apiError('未能识别番剧名称，请换一种说法', 400);
    }

    const manualRewatchTag = typeof body?.rewatchTag === 'string' ? body.rewatchTag.trim() : '';
    const results: QuickRecordResult[] = [];
    const errors: Array<{ title: string; error: string }> = [];

    for (const parsed of parsedBatch.records) {
      try {
        results.push(await processQuickRecordIntent(parsed, { rawText: text, manualRewatchTag, forceRewatch: Boolean(body?.forceRewatch) }));
      } catch (error) {
        errors.push({ title: parsed.animeTitle, error: error instanceof Error ? error.message : '处理失败' });
      }
    }

    if (results.length === 0) {
      return apiError(errors[0]?.error || 'AI 录入失败', 500, { errors });
    }

    const first = results[0];
    return apiSuccess({
      ok: true,
      count: results.length,
      createdCount: results.filter((r) => r.created).length,
      updatedCount: results.filter((r) => !r.created && !r.replay).length,
      replayCount: results.filter((r) => r.replay).length,
      historySkippedCount: results.filter((r) => !r.historyWritten).length,
      results, errors,
      created: first.created, replay: first.replay, rewatchTag: first.rewatchTag,
      parsed: first.parsed, recognition: first.recognition, entry: first.entry,
    });
  } catch (error: unknown) {
    console.error('Quick record error:', error);
    return apiError(error instanceof Error ? error.message : 'AI 录入失败', 500);
  }
}
