import { deleteAnimeRecord, getAnimeRecord, updateAnimeRecord, AnimeRecord } from '@/lib/anime';
import { buildVoiceActorAliases } from '@/lib/ai';
import { normalizeStringArray } from '@/lib/anime-cast';
import { addBatchWatchHistory, deleteWatchHistoryByAnime } from '@/lib/history';
import { query } from '@/lib/db';
import { apiSuccess, apiError, requireAdmin } from '@/lib/api-response';

function areStringArraysEqual(left: unknown, right: unknown) {
  const leftValues = normalizeStringArray(left) || [];
  const rightValues = normalizeStringArray(right) || [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function areAllowedFieldValuesEqual(key: string, nextValue: unknown, currentValue: unknown) {
  if (key === 'tags' || key === 'cast' || key === 'castAliases') {
    return areStringArraysEqual(nextValue, currentValue);
  }

  if (key === 'progress' || key === 'score' || key === 'totalEpisodes' || key === 'durationMinutes') {
    if (currentValue === undefined || currentValue === null || currentValue === '') {
      return false;
    }

    return Number(currentValue) === nextValue;
  }

  return nextValue === currentValue;
}

function parseId(idParam: string) {
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  const id = parseId(context.params.id);
  if (!id) return apiError('Invalid ID', 400);

  const record = await getAnimeRecord(id);
  if (!record) return apiError('Not found', 404);

  return apiSuccess(record);
}

export async function DELETE(
  _request: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const id = parseId(context.params.id);
  if (!id) return apiError('Invalid ID', 400);

  await deleteAnimeRecord(id);
  // Also clean up history when anime is deleted
  await deleteWatchHistoryByAnime(id);
  
  return apiSuccess({ ok: true });
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const id = parseId(context.params.id);
  if (!id) return apiError('Invalid ID', 400);

  const before = await getAnimeRecord(id);
  if (!before) return apiError('Not found', 404);

  const body = await request.json();
  const normalizedBody = {
    ...body,
    tags: normalizeStringArray(body.tags) ?? body.tags,
    cast: normalizeStringArray(body.cast) ?? body.cast,
    castAliases: normalizeStringArray(body.castAliases) ?? body.castAliases,
  };
  const allowedKeys = ['title', 'originalTitle', 'status', 'progress', 'score', 'totalEpisodes', 'notes', 'coverUrl', 'durationMinutes', 'tags', 'summary', 'startDate', 'endDate', 'premiereDate', 'cast', 'castAliases', 'isFinished'] as const;
  type AllowedKey = (typeof allowedKeys)[number];
  const updateData: Partial<AnimeRecord> = {};
  const updateRecord = updateData as Partial<Record<AllowedKey, unknown>>;

  for (const key of allowedKeys) {
    const value = normalizedBody[key];
    if (value !== undefined) {
      updateRecord[key] = value;
    }
  }

  for (const key of allowedKeys) {
    const value = updateRecord[key];
    if (value === undefined) {
      continue;
    }

    if (areAllowedFieldValuesEqual(key, value, before[key])) {
      delete updateRecord[key];
    }
  }

  if (updateData.cast !== undefined) {
    try {
      updateData.castAliases = await buildVoiceActorAliases(updateData.cast, updateData.castAliases || before?.castAliases || []);
    } catch (error) {
      console.error('Voice actor alias generation failed:', error);
    }
  }

  // Auto-complete logic
  const newProgress = updateData.progress !== undefined ? updateData.progress : before?.progress;
  const newTotal = updateData.totalEpisodes !== undefined ? updateData.totalEpisodes : before?.totalEpisodes;
  const newStatus = updateData.status !== undefined ? updateData.status : before?.status;

  // 1. If progress hits max, auto-complete
  if (newTotal && newProgress !== undefined && newProgress >= newTotal) {
      if (newStatus !== 'completed') {
           updateData.status = 'completed';
      }
      // If closing today and no end date set
      if (!updateData.endDate && !before?.endDate) {
          updateData.endDate = new Date().toISOString().split('T')[0];
      }
  }

  const updated = await updateAnimeRecord(id, updateData);
  if (!updated) return apiError('Not found', 404);

  if (before) {
    const delta = updated.progress - before.progress;
    // Only record history if explicitly requested (usually from the +1 button)
    if (delta > 0 && body.recordHistory) {
        await addBatchWatchHistory(updated.id, updated.title, before.progress + 1, updated.progress);
    } else if (delta < 0) {
        // If progress decreased, remove history entries beyond new progress to keep it consistent
        await query(
            'DELETE FROM watch_history WHERE animeId = ? AND episode > ?', 
            [updated.id, updated.progress]
        );
    }
  }

  return apiSuccess({ ok: true, entry: updated });
}
