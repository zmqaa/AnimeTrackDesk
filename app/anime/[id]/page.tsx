"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, PencilSquareIcon, TrashIcon, CalendarIcon, CheckCircleIcon, ClockIcon, SparklesIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { normalizeStringArray } from '@/lib/anime-cast';
import { fetchJson } from '@/lib/client-api';
import { readSessionCache, writeSessionCache } from '@/lib/hooks-shared';
import type { AnimeStatus, AnimeDetailItem, SessionUser } from '@/lib/anime-shared';

const statusMap: Record<AnimeStatus, string> = {
  watching: '追番中',
  completed: '已看完',
  dropped: '已弃坑',
  plan_to_watch: '计划看',
};

const statusBadgeStyles: Record<AnimeStatus, string> = {
  watching: 'theme-status-watching',
  completed: 'theme-status-completed',
  dropped: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  plan_to_watch: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
};

function formatDateLabel(value?: string) {
  return value || '未记录';
}

function formatTimestampLabel(value?: string) {
  if (!value) {
    return '未记录';
  }

  return value.replace('T', ' ').slice(0, 16);
}

function toTagInputValue(value: AnimeDetailItem['tags'] | string | undefined) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return value || '';
}

type AnimeMutationResponse = {
  ok?: boolean;
  entry: AnimeDetailItem;
  appliedFields?: string[];
};

const OMIT_FIELD = Symbol('omit-field');
const editableKeys = [
  'title',
  'originalTitle',
  'status',
  'progress',
  'score',
  'totalEpisodes',
  'notes',
  'coverUrl',
  'durationMinutes',
  'tags',
  'summary',
  'startDate',
  'endDate',
  'premiereDate',
  'cast',
  'isFinished',
] as const;
const arrayKeys = new Set(['tags', 'cast']);
const requiredNumericKeys = new Set(['progress']);
const nullableNumericKeys = new Set(['score', 'totalEpisodes', 'durationMinutes']);
const nullableTextKeys = new Set(['originalTitle', 'notes', 'coverUrl', 'summary', 'startDate', 'endDate', 'premiereDate']);
const ANIME_LIST_CACHE_KEY = 'anime-list-items';

type EditableField = (typeof editableKeys)[number];
type AnimeDetailPatchPayload = Partial<Record<EditableField, unknown>>;

function resolveReturnTo(rawValue: string | null) {
  if (!rawValue) {
    return '/anime';
  }

  return rawValue.startsWith('/anime') ? rawValue : '/anime';
}

function updateAnimeListCache(nextEntry: AnimeDetailItem) {
  const cached = readSessionCache<AnimeDetailItem[]>(ANIME_LIST_CACHE_KEY);
  if (!cached) {
    return;
  }

  const nextItems = cached.map((item) => (item.id === nextEntry.id ? { ...item, ...nextEntry } : item));
  writeSessionCache(ANIME_LIST_CACHE_KEY, nextItems);
}

function removeAnimeFromListCache(animeId: number) {
  const cached = readSessionCache<AnimeDetailItem[]>(ANIME_LIST_CACHE_KEY);
  if (!cached) {
    return;
  }

  writeSessionCache(ANIME_LIST_CACHE_KEY, cached.filter((item) => item.id !== animeId));
}

function areStringArraysEqual(left: unknown, right: unknown) {
  const leftValues = normalizeStringArray(left) || [];
  const rightValues = normalizeStringArray(right) || [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function isMissingValue(value: unknown) {
  return value === undefined || value === null || value === '';
}

function normalizeEditableFieldValue(key: EditableField, value: unknown): unknown {
  if (arrayKeys.has(key)) {
    return normalizeStringArray(value);
  }

  if (requiredNumericKeys.has(key)) {
    return isMissingValue(value) ? 0 : Number(value);
  }

  if (nullableNumericKeys.has(key)) {
    if (isMissingValue(value)) {
      return null;
    }

    return Number(value);
  }

  if (nullableTextKeys.has(key)) {
    return isMissingValue(value) ? null : value;
  }

  if (key === 'isFinished') {
    if (value === undefined) {
      return OMIT_FIELD;
    }

    return Boolean(value);
  }

  return value;
}

function isFieldValueUnchanged(key: EditableField, nextValue: unknown, currentValue: unknown) {
  if (arrayKeys.has(key)) {
    return areStringArraysEqual(nextValue, currentValue);
  }

  if (requiredNumericKeys.has(key)) {
    return Number(currentValue ?? 0) === nextValue;
  }

  if (nullableNumericKeys.has(key)) {
    if (nextValue === null) {
      return isMissingValue(currentValue);
    }

    if (currentValue === undefined || currentValue === null || currentValue === '') {
      return false;
    }

    return Number(currentValue) === nextValue;
  }

  if (nullableTextKeys.has(key)) {
    if (nextValue === null) {
      return isMissingValue(currentValue);
    }

    return nextValue === currentValue;
  }

  if (key === 'isFinished') {
    return nextValue === currentValue;
  }

  return nextValue === currentValue;
}

function buildChangedPayload(formData: Partial<AnimeDetailItem>, item: AnimeDetailItem): AnimeDetailPatchPayload {
  const payload: AnimeDetailPatchPayload = {};

  for (const key of editableKeys) {
    const normalizedValue = normalizeEditableFieldValue(key, formData[key]);
    if (normalizedValue === OMIT_FIELD) {
      continue;
    }

    if (isFieldValueUnchanged(key, normalizedValue, item[key])) {
      continue;
    }

    (payload as Record<string, unknown>)[key] = normalizedValue;
  }

  return payload;
}

export default function AnimeDetailPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = (session?.user as SessionUser | undefined)?.role === 'admin';
  const [item, setItem] = useState<AnimeDetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<AnimeDetailItem>>({});
  const [isAiEnriching, setIsAiEnriching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const returnTo = useMemo(() => resolveReturnTo(searchParams.get('returnTo')), [searchParams]);
  const canEdit = isAdmin && isEditing;

  useEffect(() => {
    if (!isAdmin) {
      setIsEditing(false);
    }
  }, [isAdmin]);

  const handleReturnToList = () => {
    router.push(returnTo, { scroll: false });
  };

  useEffect(() => {
    fetchJson<AnimeDetailItem>(`/api/anime/${params.id}`, undefined, 'Not found')
      .then((data) => {
        setItem(data);
        setFormData(data);
      })
      .catch((error) => {
        console.error(error);
        router.push(returnTo);
      })
      .finally(() => setLoading(false));
  }, [params.id, returnTo, router]);

  const handleChange = (key: keyof AnimeDetailItem, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const saveChanges = async () => {
    if (!item || !isAdmin) {
      return;
    }

    const payload = buildChangedPayload(formData, item);
    if (Object.keys(payload).length === 0) {
      toast('没有需要保存的变更', { icon: 'ℹ️' });
      return;
    }

    setSaving(true);
    try {
      const response = await fetchJson<AnimeMutationResponse>(`/api/anime/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, '保存失败');
      const updated = response.entry;
      setItem(updated);
      setFormData(updated);
      updateAnimeListCache(updated);
      setIsEditing(false);
      toast.success('保存成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存出错');
    } finally {
      setSaving(false);
    }
  };

  const enrichAnimeInfo = async () => {
    if (!isAdmin) {
      return;
    }

    setIsAiEnriching(true);
    try {
      const response = await fetchJson<AnimeMutationResponse>(`/api/anime/${params.id}/enrich`, { method: 'POST' }, 'AI补充失败');

      const updated = response.entry;
      setItem(updated);
      setFormData(updated);
      updateAnimeListCache(updated);

      const appliedCount = Array.isArray(response.appliedFields) ? response.appliedFields.length : 0;
      if (appliedCount === 0) {
        toast('没有可补充的空缺字段', { icon: 'ℹ️' });
      } else {
        toast.success(`已补充 ${appliedCount} 个字段`);
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'AI补充失败');
    } finally {
      setIsAiEnriching(false);
    }
  };

  const deleteAnime = async () => {
    if (!isAdmin) {
      return;
    }

    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await fetchJson<{ ok: true }>(`/api/anime/${params.id}`, { method: 'DELETE' }, '删除失败');
      removeAnimeFromListCache(Number(params.id));
      toast.success('已删除');
      router.push(returnTo, { scroll: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const coverUrl = useMemo(() => {
    const editableCover = typeof formData.coverUrl === 'string' ? formData.coverUrl : undefined;
    return editableCover || item?.coverUrl || '';
  }, [formData.coverUrl, item?.coverUrl]);

  const displayStatus = ((formData.status as AnimeStatus | undefined) || item?.status || 'watching') as AnimeStatus;
  const displayProgress = Number(formData.progress ?? item?.progress ?? 0) || 0;
  const displayTotalEpisodes = Number(formData.totalEpisodes ?? item?.totalEpisodes ?? 0) || undefined;
  const displayDuration = Number(formData.durationMinutes ?? item?.durationMinutes ?? 0) || undefined;
  const displayScoreValue: unknown = formData.score ?? item?.score;
  const displayScore = displayScoreValue === undefined || displayScoreValue === '' || displayScoreValue === null
    ? undefined
    : Number(displayScoreValue);
  const displayTags = Array.isArray(item?.tags) ? item.tags : [];
  const progressPercent = displayTotalEpisodes && displayTotalEpisodes > 0
    ? Math.min(100, (displayProgress / displayTotalEpisodes) * 100)
    : (displayStatus === 'completed' ? 100 : Math.min(displayProgress * 8, 100));

  if (loading) {
    return <div className="p-12 text-center text-zinc-500">Loading details...</div>;
  }

  if (!item) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-[1660px] px-4 md:px-6 xl:px-8 2xl:px-10 pb-20 animate-in fade-in zoom-in-95 duration-300">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-300/10 shadow-[0_30px_80px_rgba(0,0,0,0.45)]" style={{ backgroundColor: 'var(--background)' }}>
        {coverUrl && (
          <div className="absolute inset-0 opacity-[0.08]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverUrl} alt={item.title} className="h-full w-full scale-110 object-cover blur-3xl" />
          </div>
        )}
        <div className="theme-detail-aura absolute inset-0" />

        <div className="relative p-5 md:p-8 xl:p-10 2xl:p-12">
          <button onClick={handleReturnToList} className="flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            <span>返回列表</span>
          </button>

          <div className="mt-6 grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[390px_minmax(0,1fr)] 2xl:gap-10">
            <aside className="space-y-5 xl:sticky xl:top-8 xl:self-start">
              <div className="glass-panel-strong overflow-hidden rounded-[28px] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                <div className="aspect-[2/3] w-full bg-zinc-900">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-700">No Image</div>
                  )}
                </div>

                <div className="border-t border-white/5 bg-black/20 p-4">
                  <div className={`rounded-2xl border px-4 py-3 text-center text-sm font-semibold tracking-[0.2em] ${statusBadgeStyles[displayStatus]}`}>
                    {statusMap[displayStatus]}
                  </div>
                </div>
              </div>

              <div className="surface-card rounded-[24px] p-5 2xl:p-6 backdrop-blur-xl">
                {canEdit ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">状态</label>
                      <select
                        value={formData.status || item.status}
                        onChange={(event) => handleChange('status', event.target.value as AnimeStatus)}
                        className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                      >
                        {Object.keys(statusMap).map((status) => (
                          <option key={status} value={status}>{statusMap[status as AnimeStatus]}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">评分</label>
                        <input
                          type="number"
                          value={formData.score ?? ''}
                          onChange={(event) => handleChange('score', event.target.value)}
                          className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">单集时长</label>
                        <input
                          type="number"
                          value={formData.durationMinutes ?? ''}
                          onChange={(event) => handleChange('durationMinutes', event.target.value)}
                          className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">封面链接</label>
                      <input
                        value={formData.coverUrl || ''}
                        onChange={(event) => handleChange('coverUrl', event.target.value)}
                        className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">评分</div>
                      <div className="mt-2 text-lg font-semibold text-amber-300">{displayScore ? `★ ${displayScore}` : '-'}</div>
                    </div>
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">集数</div>
                      <div className="mt-2 text-lg font-semibold text-zinc-100">{displayTotalEpisodes || '?'}</div>
                    </div>
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">时长</div>
                      <div className="mt-2 text-lg font-semibold text-zinc-100">{displayDuration ? `${displayDuration}m` : '-'}</div>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="space-y-6">
              <div className="surface-card rounded-[28px] p-6 md:p-8 xl:p-9 2xl:p-10 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    {canEdit ? (
                      <input
                        value={formData.title || ''}
                        onChange={(event) => handleChange('title', event.target.value)}
                        className="theme-focus-accent w-full border-b border-white/10 bg-transparent pb-2 text-3xl font-semibold tracking-tight text-white transition"
                      />
                    ) : (
                      <h1 className="text-3xl font-semibold tracking-tight text-white md:text-[2.5rem]">{item.title}</h1>
                    )}

                    {canEdit ? (
                      <input
                        value={formData.originalTitle || ''}
                        placeholder="原名 / 日文名"
                        onChange={(event) => handleChange('originalTitle', event.target.value)}
                        className="theme-focus-accent w-full border-b border-white/10 bg-transparent pb-2 text-lg text-zinc-400 transition"
                      />
                    ) : (
                      item.originalTitle && <p className="text-lg text-zinc-400">{item.originalTitle}</p>
                    )}

                    {canEdit ? (
                      <input
                        value={toTagInputValue(formData.tags)}
                        onChange={(event) => handleChange('tags', event.target.value)}
                        placeholder="标签 (逗号分隔)"
                        className="surface-input theme-focus-accent w-full rounded-2xl px-4 py-3 text-sm text-white transition"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {displayTags.map((tag) => (
                          <span key={tag} className="surface-pill rounded-full px-3 py-1 text-xs text-zinc-200">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                    {isAdmin ? (
                      <>
                        {canEdit ? (
                          <>
                            <button
                              onClick={enrichAnimeInfo}
                              disabled={isAiEnriching}
                              className="surface-pill rounded-xl px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isAiEnriching ? 'AI补充中...' : 'AI补充'}
                            </button>
                            <button onClick={() => setIsEditing(false)} className="rounded-xl px-4 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-900/80 hover:text-white">
                              取消
                            </button>
                            <button
                              onClick={saveChanges}
                              disabled={saving}
                              className="theme-accent-button rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50"
                            >
                              {saving ? '保存中...' : '保存更改'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={enrichAnimeInfo}
                              disabled={isAiEnriching}
                              className="surface-pill rounded-xl px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isAiEnriching ? 'AI补充中...' : 'AI补充'}
                            </button>
                            <button
                              onClick={() => setIsEditing(true)}
                              className="surface-pill rounded-xl p-2.5 text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                            >
                              <PencilSquareIcon className="h-5 w-5" />
                            </button>
                          </>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">观看状态</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{statusMap[displayStatus]}</div>
                    <div className="mt-1 text-xs text-zinc-500">{item.isFinished ? '片源已完结' : '仍可能继续更新'}</div>
                  </div>
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">当前进度</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{displayProgress} / {displayTotalEpisodes || '?'} EP</div>
                    <div className="mt-1 text-xs text-zinc-500">完成度 {Math.round(progressPercent)}%</div>
                  </div>
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">最近编辑</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{formatTimestampLabel(item.updatedAt)}</div>
                    <div className="mt-1 text-xs text-zinc-500">创建于 {formatDateLabel(item.createdAt?.slice(0, 10))}</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(320px,0.92fr)] 2xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.95fr)] 2xl:gap-8">
                <div className="space-y-6">
                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                        <CheckCircleIcon className="h-4 w-4" />
                        观看进度
                      </h3>
                      <span className="font-mono text-sm text-zinc-300">
                        {canEdit ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={formData.progress ?? item.progress}
                              onChange={(event) => handleChange('progress', event.target.value)}
                              className="surface-input theme-focus-accent w-20 rounded-xl px-2 py-1.5 text-center text-sm text-white transition"
                            />
                            <span>/</span>
                            <input
                              type="number"
                              value={formData.totalEpisodes ?? item.totalEpisodes ?? ''}
                              onChange={(event) => handleChange('totalEpisodes', event.target.value)}
                              placeholder="?"
                              className="surface-input theme-focus-accent w-20 rounded-xl px-2 py-1.5 text-center text-sm text-white transition"
                            />
                          </div>
                        ) : (
                          <>
                            <span className="text-2xl text-white">{displayProgress}</span>
                            <span className="mx-1 text-zinc-500">/</span>
                            <span>{displayTotalEpisodes || '?'}</span>
                            <span className="ml-1 text-xs text-zinc-500">EP</span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-900/90">
                      <div
                        className="theme-spectrum-gradient h-full rounded-full transition-all duration-700"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">首播</div>
                        <div className="mt-2 text-sm text-zinc-100">{formatDateLabel(item.premiereDate)}</div>
                      </div>
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">单集时长</div>
                        <div className="mt-2 text-sm text-zinc-100">{displayDuration ? `${displayDuration} min` : '未知'}</div>
                      </div>
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">片源状态</div>
                        <div className={`mt-2 text-sm font-medium ${item.isFinished ? 'theme-accent-text' : 'theme-secondary-text'}`}>
                          {item.isFinished ? '已完结' : '连载中'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <SparklesIcon className="h-4 w-4" />
                      简介 / 剧情
                    </div>
                    {canEdit ? (
                      <textarea
                        rows={8}
                        value={formData.summary || ''}
                        onChange={(event) => handleChange('summary', event.target.value)}
                        className="surface-input theme-focus-accent mt-4 min-h-[220px] w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : (
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-8 text-zinc-300">
                        {item.summary || '暂无简介'}
                      </p>
                    )}
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <ClockIcon className="h-4 w-4" />
                      个人备注
                    </div>
                    {canEdit ? (
                      <textarea
                        rows={4}
                        value={formData.notes || ''}
                        onChange={(event) => handleChange('notes', event.target.value)}
                        className="surface-input theme-focus-accent mt-4 w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : (
                      <p className="mt-4 text-sm italic leading-7 text-zinc-400">
                        {item.notes || '还没有留下观后感。'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <CalendarIcon className="h-4 w-4" />
                      时间轴
                    </div>

                    <div className="mt-4 space-y-3 text-sm">
                      <div className="surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
                        <span className="text-zinc-500">开始观看</span>
                        {canEdit ? (
                          <input
                            type="date"
                            value={formData.startDate || ''}
                            onChange={(event) => handleChange('startDate', event.target.value)}
                            className="surface-input theme-focus-accent rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.startDate)}</span>
                        )}
                      </div>

                      <div className="surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
                        <span className="text-zinc-500">看完日期</span>
                        {canEdit ? (
                          <input
                            type="date"
                            value={formData.endDate || ''}
                            onChange={(event) => handleChange('endDate', event.target.value)}
                            className="surface-input theme-focus-accent rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.endDate)}</span>
                        )}
                      </div>

                      <div className="surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
                        <span className="text-zinc-500">首播日期</span>
                        {canEdit ? (
                          <input
                            type="date"
                            value={formData.premiereDate || ''}
                            onChange={(event) => handleChange('premiereDate', event.target.value)}
                            className="surface-input theme-focus-accent rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.premiereDate)}</span>
                        )}
                      </div>

                      <div className="surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
                        <span className="text-zinc-500">放送状态</span>
                        {canEdit ? (
                          <label className="flex items-center gap-2 text-sm text-zinc-200">
                            <input
                              type="checkbox"
                              checked={Boolean(formData.isFinished ?? item.isFinished)}
                              onChange={(event) => handleChange('isFinished', event.target.checked)}
                              className="h-4 w-4 rounded border-white/10 bg-zinc-950 text-primary focus:ring-primary"
                            />
                            已完结
                          </label>
                        ) : (
                          <span className={item.isFinished ? 'theme-accent-text' : 'theme-secondary-text'}>{item.isFinished ? '已完结' : '连载中'}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                        <SparklesIcon className="h-4 w-4" />
                        声优阵容
                      </div>
                      {!canEdit && item.cast && item.cast.length > 0 && (
                        <span className="text-xs text-zinc-500">{item.cast.length} 名</span>
                      )}
                    </div>

                    {canEdit ? (
                      <textarea
                        rows={5}
                        value={Array.isArray(formData.cast) ? formData.cast.join(', ') : (formData.cast || '')}
                        placeholder="花泽香菜, 宫野真守 (逗号分隔)"
                        onChange={(event) => {
                          handleChange('cast', event.target.value.split(/[,，]/).map((name) => name.trim()).filter(Boolean));
                        }}
                        className="surface-input theme-focus-accent mt-4 w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : item.cast && item.cast.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.cast.map((cv, index) => (
                          <Link
                            key={`${cv}-${index}`}
                            href={`/anime?cast=${encodeURIComponent(cv)}`}
                            className="theme-secondary-soft rounded-full px-3 py-1.5 text-xs transition"
                          >
                            {cv}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-zinc-500">还没有补到声优信息。</p>
                    )}
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/5 p-5 backdrop-blur-xl">
                  <button onClick={deleteAnime} className="flex items-center gap-2 text-sm text-rose-300 transition hover:text-rose-200">
                    <TrashIcon className="h-4 w-4" />
                    删除此番剧
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除番剧"
        message={`确定要删除「${item.title}」吗？删除后其观看历史也会一并清除，无法恢复。`}
        confirmText="确认删除"
        cancelText="再想想"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}