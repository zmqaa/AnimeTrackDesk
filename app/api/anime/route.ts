import { NextRequest } from 'next/server';
import { listAnimeRecordsWithLastWatched, createAnimeRecord, CreateAnimeDTO, AnimeStatus } from '@/lib/anime';
import { normalizeStringArray } from '@/lib/anime-cast';
import { enrichAnimeInput } from '@/lib/anime-enrichment';
import { apiSuccess, apiError, requireAdmin } from '@/lib/api-response';
import { createAnimeSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as AnimeStatus | undefined;
  const limit = Number(searchParams.get('limit') || '0');
  const offset = Number(searchParams.get('offset') || '0');
  
  try {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : undefined;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : undefined;
    const list = await listAnimeRecordsWithLastWatched({ status: status || undefined, limit: safeLimit, offset: safeOffset });
    return apiSuccess(list, 200, { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取失败';
    return apiError(message);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const json = await request.json();
    const parsed = createAnimeSchema.safeParse(json);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return apiError(firstError?.message || '参数校验失败', 400);
    }

    const v = parsed.data;
    let data: CreateAnimeDTO = {
        title: v.title,
        originalTitle: v.originalTitle || undefined,
        status: v.status || 'plan_to_watch',
        progress: v.progress || 0,
        coverUrl: v.coverUrl || undefined,
        score: v.score ?? undefined,
        totalEpisodes: v.totalEpisodes ?? undefined,
        notes: v.notes || undefined,
        durationMinutes: v.durationMinutes ?? undefined,
        tags: normalizeStringArray(v.tags),
        cast: normalizeStringArray(v.cast),
        castAliases: normalizeStringArray(v.castAliases),
        summary: v.summary || undefined,
        startDate: v.startDate || undefined,
        endDate: v.endDate || undefined,
        premiereDate: v.premiereDate || undefined,
        isFinished: typeof v.isFinished === 'boolean' ? v.isFinished : undefined
    };

    const originalUserTitle = data.title;

    data = await enrichAnimeInput(data, {
        mode: 'create',
        originalUserTitle,
    });

    // Auto-complete logic: if status is completed or has end date, set progress to total
    if ((data.status === 'completed' || data.endDate) && data.totalEpisodes) {
        data.progress = data.totalEpisodes;
        if (!data.status) data.status = 'completed';
    }

    const newRecord = await createAnimeRecord(data);

    return apiSuccess(newRecord);
  } catch (error: unknown) {
    console.error('Anime create error:', error);
    const message = error instanceof Error ? error.message : '创建失败';
    return apiError(message);
  }
}
