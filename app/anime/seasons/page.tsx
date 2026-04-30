"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronLeftIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { useAnimeData } from '@/hooks/useAnimeData';
import { AnimeRecord, statusLabels } from '@/lib/dashboard-types';
import { formatShortDate } from '@/lib/formatters';

type SeasonName = '1月' | '4月' | '7月' | '10月';
type SortDirection = 'desc' | 'asc';

interface SeasonBucket {
  key: string;
  year: number;
  season: SeasonName;
  seasonOrder: number;
  count: number;
  started: number;
  completed: number;
  watching: number;
  totalProgress: number;
  lastWatchedAt?: string;
  items: AnimeRecord[];
}

interface VisibleSeasonBucket {
  bucket: SeasonBucket;
  visibleItems: AnimeRecord[];
}

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function parsePremiere(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

function seasonFromMonth(month: number): { season: SeasonName; seasonOrder: number } {
  if (month <= 2) return { season: '1月', seasonOrder: 0 };
  if (month <= 5) return { season: '4月', seasonOrder: 1 };
  if (month <= 8) return { season: '7月', seasonOrder: 2 };
  return { season: '10月', seasonOrder: 3 };
}

function hasStartedWatching(anime: AnimeRecord) {
  return Boolean(anime.lastWatchedAt) || Boolean(anime.startDate) || Boolean(anime.endDate) || anime.progress > 0 || anime.status === 'watching' || anime.status === 'completed';
}

function getSeasonPremiere(anime: AnimeRecord, referenceDate: Date) {
  const premiere = parsePremiere(anime.premiereDate);
  if (!premiere) return null;
  return premiere.getTime() > referenceDate.getTime() ? null : premiere;
}

function toDateValue(value?: string) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function compareDateDesc(left?: string, right?: string) {
  const leftTime = toDateValue(left);
  const rightTime = toDateValue(right);
  const leftMissing = Number.isNaN(leftTime);
  const rightMissing = Number.isNaN(rightTime);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return rightTime - leftTime;
}

function compareSeasonAnime(left: AnimeRecord, right: AnimeRecord) {
  const watchCompare = compareDateDesc(left.lastWatchedAt, right.lastWatchedAt);
  if (watchCompare !== 0) return watchCompare;

  const startedCompare = Number(hasStartedWatching(right)) - Number(hasStartedWatching(left));
  if (startedCompare !== 0) return startedCompare;

  const progressCompare = (right.progress || 0) - (left.progress || 0);
  if (progressCompare !== 0) return progressCompare;

  const scoreCompare = (right.score || 0) - (left.score || 0);
  if (scoreCompare !== 0) return scoreCompare;

  return left.title.localeCompare(right.title, 'zh-CN');
}

function formatSeasonLastWatchLabel(bucket: SeasonBucket) {
  if (bucket.lastWatchedAt) {
    return formatShortDate(bucket.lastWatchedAt);
  }

  return bucket.started > 0 ? '无记录' : '未触达';
}

function formatAnimeWatchState(anime: AnimeRecord) {
  if (anime.lastWatchedAt) {
    return `最近观看 ${formatShortDate(anime.lastWatchedAt)}`;
  }

  if (anime.status === 'completed' || Boolean(anime.endDate)) {
    return '已看完，缺少时间记录';
  }

  if (hasStartedWatching(anime)) {
    return '已开始追番，缺少时间记录';
  }

  return '还没开始追';
}

export default function AnimeSeasonsPage() {
  const { animeList, isLoading: animeLoading } = useAnimeData();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [showStartedOnly, setShowStartedOnly] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isYearMenuOpen, setIsYearMenuOpen] = useState(false);
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});
  const yearMenuRef = useRef<HTMLDivElement | null>(null);

  const seasonAnimeEntries = useMemo(
    () => animeList.flatMap((anime) => {
      const premiere = getSeasonPremiere(anime, today);
      return premiere ? [{ anime, premiere }] : [];
    }),
    [animeList, today]
  );

  const seasonBuckets = useMemo<SeasonBucket[]>(() => {
    const map = new Map<string, {
      year: number;
      season: SeasonName;
      seasonOrder: number;
      count: number;
      started: number;
      completed: number;
      watching: number;
      totalProgress: number;
      lastWatchedAt?: string;
      items: AnimeRecord[];
    }>();

    seasonAnimeEntries.forEach(({ anime, premiere }) => {
      const year = premiere.getFullYear();
      const { season, seasonOrder } = seasonFromMonth(premiere.getMonth());
      const key = `${year}-${seasonOrder}`;
      const bucket = map.get(key) ?? {
        year,
        season,
        seasonOrder,
        count: 0,
        started: 0,
        completed: 0,
        watching: 0,
        totalProgress: 0,
        lastWatchedAt: undefined,
        items: [],
      };

      const started = hasStartedWatching(anime);
      bucket.count += 1;
      if (started) {
        bucket.started += 1;
      }
      if (anime.status === 'completed') {
        bucket.completed += 1;
      }
      if (anime.status === 'watching') {
        bucket.watching += 1;
      }
      bucket.totalProgress += anime.progress || 0;
      if (compareDateDesc(anime.lastWatchedAt, bucket.lastWatchedAt) < 0) {
        bucket.lastWatchedAt = anime.lastWatchedAt;
      }
      bucket.items.push(anime);

      map.set(key, bucket);
    });

    return Array.from(map.entries())
      .map(([key, bucket]) => ({
        key,
        year: bucket.year,
        season: bucket.season,
        seasonOrder: bucket.seasonOrder,
        count: bucket.count,
        started: bucket.started,
        completed: bucket.completed,
        watching: bucket.watching,
        totalProgress: bucket.totalProgress,
        lastWatchedAt: bucket.lastWatchedAt,
        items: [...bucket.items].sort(compareSeasonAnime),
      }))
      .sort((left, right) => right.year - left.year || right.seasonOrder - left.seasonOrder);
  }, [seasonAnimeEntries]);

  const availableYears = useMemo(
    () => Array.from(new Set(seasonBuckets.map((bucket) => bucket.year))).sort((left, right) => right - left),
    [seasonBuckets]
  );

  const visibleSeasonBuckets = useMemo<VisibleSeasonBucket[]>(() => {
    const orderedBuckets = [...seasonBuckets]
      .filter((bucket) => selectedYear === 'all' || bucket.year === selectedYear)
      .sort((left, right) => {
        const compare = left.year - right.year || left.seasonOrder - right.seasonOrder;
        return sortDirection === 'asc' ? compare : -compare;
      });

    return orderedBuckets.flatMap((bucket) => {
      const visibleItems = showStartedOnly
        ? bucket.items.filter(hasStartedWatching)
        : bucket.items;

      if (!visibleItems.length) {
        return [];
      }

      return [{ bucket, visibleItems }];
    });
  }, [seasonBuckets, selectedYear, showStartedOnly, sortDirection]);

  const withPremiereCount = useMemo(
    () => seasonAnimeEntries.length,
    [seasonAnimeEntries]
  );

  const startedCount = useMemo(
    () => seasonAnimeEntries.filter(({ anime }) => hasStartedWatching(anime)).length,
    [seasonAnimeEntries]
  );

  const completedCount = useMemo(
    () => seasonAnimeEntries.filter(({ anime }) => anime.status === 'completed').length,
    [seasonAnimeEntries]
  );

  const totalProgressEpisodes = useMemo(
    () => seasonAnimeEntries.reduce((sum, { anime }) => sum + (anime.progress || 0), 0),
    [seasonAnimeEntries]
  );
  const visibleAnimeCount = useMemo(
    () => visibleSeasonBuckets.reduce((sum, entry) => sum + entry.visibleItems.length, 0),
    [visibleSeasonBuckets]
  );
  const yearScopeLabel = selectedYear === 'all' ? '全部年份' : `${selectedYear} 年`;
  const orderScopeLabel = sortDirection === 'desc' ? '从新到旧' : '从旧到新';
  const loading = animeLoading;

  useEffect(() => {
    if (!isYearMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (yearMenuRef.current && !yearMenuRef.current.contains(event.target as Node)) {
        setIsYearMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsYearMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isYearMenuOpen]);

  return (
    <main className="p-4 lg:p-8 pb-24 space-y-6 lg:space-y-8 animate-fade-in relative">
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(circle_at_top_left,rgba(93,214,242,0.1),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(244,191,98,0.08),transparent_30%)]" />

      <section className="glass-panel-strong relative overflow-hidden rounded-[36px] p-7 lg:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_35%),linear-gradient(135deg,rgba(93,214,242,0.12),transparent_42%,rgba(244,191,98,0.1))]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Link href="/" className="inline-flex items-center gap-1 text-zinc-400 hover:text-white text-sm transition-colors">
              <ChevronLeftIcon className="w-4 h-4" /> 返回总览
            </Link>
            <h1 className="text-3xl font-display font-semibold tracking-tight text-zinc-50 md:text-4xl">开播季度回顾</h1>
            <p className="text-sm leading-7 text-zinc-400 md:text-base">
              按作品真正已经开播的季度回看你的片库：这个季度你收了什么、开始追了什么、追到哪儿。这里只看 premiereDate 已填写且已经到过首播日的作品。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-full lg:min-w-[360px] lg:max-w-[380px]">
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Premiere</div>
              <div className="mt-2 text-2xl font-mono text-zinc-100">{withPremiereCount}</div>
              <div className="text-xs text-zinc-500 mt-1">已开播且有首播日期的作品</div>
            </div>
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Started</div>
              <div className="theme-secondary-text mt-2 text-2xl font-mono">{startedCount}</div>
              <div className="text-xs text-zinc-500 mt-1">已经开始追过的作品</div>
            </div>
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Completed</div>
              <div className="theme-accent-text mt-2 text-2xl font-mono">{completedCount}</div>
              <div className="text-xs text-zinc-500 mt-1">你已经看完的作品</div>
            </div>
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Progress</div>
              <div className="mt-2 text-2xl font-mono text-amber-300">{totalProgressEpisodes}</div>
              <div className="text-xs text-zinc-500 mt-1">这些开播季里的累计进度</div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-20 flex flex-col gap-4 rounded-[30px] border border-white/8 bg-white/[0.025] px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Notebook Scope</div>
          <div className="text-sm text-zinc-300 lg:text-base">
            {showStartedOnly ? '当前只显示已经开始追番的作品卡片。' : '当前显示全部已开播作品。'}
            {` 年份范围：${yearScopeLabel}；排序：${orderScopeLabel}。`}
          </div>
          <div className="text-xs text-zinc-500 lg:text-sm">覆盖 {visibleSeasonBuckets.length} 个季度，共 {visibleAnimeCount} 部作品。</div>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowStartedOnly(false)}
              aria-pressed={!showStartedOnly}
              className={showStartedOnly
                ? 'surface-pill rounded-full px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-white'
                : 'theme-secondary-soft rounded-full px-4 py-2 text-sm text-white'}
            >
              全部开播作品
            </button>
            <button
              type="button"
              onClick={() => setShowStartedOnly(true)}
              aria-pressed={showStartedOnly}
              className={showStartedOnly
                ? 'theme-secondary-soft rounded-full px-4 py-2 text-sm text-white'
                : 'surface-pill rounded-full px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-white'}
            >
              只看已开始追番
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Year
            </span>
            <div ref={yearMenuRef} className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isYearMenuOpen}
                onClick={() => setIsYearMenuOpen((current) => !current)}
                className="surface-input theme-focus-accent flex min-w-[132px] items-center justify-between gap-3 rounded-full px-4 py-2 text-sm text-zinc-100 transition-colors hover:border-white/15 hover:text-white"
              >
                <span>{yearScopeLabel}</span>
                <ChevronUpDownIcon className="h-4 w-4 text-zinc-400" />
              </button>

              {isYearMenuOpen && (
                <div
                  role="listbox"
                  aria-label="按年份筛选季度"
                  className="surface-card absolute right-0 top-[calc(100%+0.65rem)] z-30 flex max-h-80 min-w-[180px] flex-col overflow-hidden rounded-[22px] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedYear('all');
                      setIsYearMenuOpen(false);
                    }}
                    className={selectedYear === 'all'
                      ? 'theme-secondary-soft flex items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm'
                      : 'flex items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white'}
                  >
                    <span>全部年份</span>
                    {selectedYear === 'all' && <CheckIcon className="h-4 w-4" />}
                  </button>
                  <div className="my-1 h-px bg-white/6" />
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                    {availableYears.map((year) => (
                      <button
                        key={year}
                        type="button"
                        onClick={() => {
                          setSelectedYear(year);
                          setIsYearMenuOpen(false);
                        }}
                        className={selectedYear === year
                          ? 'theme-secondary-soft flex items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm'
                          : 'flex items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white'}
                      >
                        <span>{year} 年</span>
                        {selectedYear === year && <CheckIcon className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSortDirection('desc')}
              aria-pressed={sortDirection === 'desc'}
              className={sortDirection === 'desc'
                ? 'theme-secondary-soft rounded-full px-4 py-2 text-sm text-white'
                : 'surface-pill rounded-full px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-white'}
            >
              最新在前
            </button>
            <button
              type="button"
              onClick={() => setSortDirection('asc')}
              aria-pressed={sortDirection === 'asc'}
              className={sortDirection === 'asc'
                ? 'theme-secondary-soft rounded-full px-4 py-2 text-sm text-white'
                : 'surface-pill rounded-full px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-white'}
            >
              最早在前
            </button>
          </div>
        </div>
      </section>

      <section className="relative z-10 space-y-5">
        {visibleSeasonBuckets.map(({ bucket, visibleItems }) => {
          const isExpanded = Boolean(expandedBuckets[bucket.key]);
          const canExpand = visibleItems.length > 6;
          const renderedItems = isExpanded ? visibleItems : visibleItems.slice(0, 6);

          return (
            <article key={bucket.key} className="glass-panel rounded-[34px] p-7 lg:p-8 xl:p-9">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Season Block</div>
                  <h2 className="mt-2 text-[2rem] font-display leading-none text-zinc-100 lg:text-[2.35rem]">{bucket.year}年 {bucket.season}番</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="surface-pill rounded-full px-4 py-2 text-sm text-zinc-300">入库 {bucket.count} 部</span>
                  <span className="theme-secondary-soft rounded-full px-4 py-2 text-sm">已开始追番 {bucket.started} 部</span>
                  <span className="theme-accent-soft rounded-full px-4 py-2 text-sm">已看完 {bucket.completed} 部</span>
                  <span className="theme-warm-soft rounded-full px-4 py-2 text-sm">追番中 {bucket.watching} 部</span>
                  {showStartedOnly && (
                    <span className="surface-pill rounded-full px-4 py-2 text-sm text-zinc-300">当前展示 {visibleItems.length} 部</span>
                  )}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="surface-card rounded-[22px] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Progress</div>
                  <div className="mt-2 text-2xl font-mono text-zinc-100">{bucket.totalProgress} 集</div>
                  <div className="mt-1 text-sm text-zinc-500">这个开播季累计看了多少集</div>
                </div>
                <div className="surface-card rounded-[22px] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Last Watch</div>
                  <div className="mt-2 text-2xl font-mono text-zinc-100">{formatSeasonLastWatchLabel(bucket)}</div>
                  <div className="mt-1 text-sm text-zinc-500">最近一次追这个档期里的作品；没有时间记录时会单独标出来</div>
                </div>
                <div className="surface-card rounded-[22px] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Season View</div>
                  <div className="mt-2 text-2xl font-mono text-zinc-100">{bucket.started}/{bucket.count}</div>
                  <div className="mt-1 text-sm text-zinc-500">已经开始追番的作品数量</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {renderedItems.map((anime) => (
                  <Link
                    key={anime.id}
                    href={`/anime/${anime.id}`}
                    className="group surface-card-muted rounded-[22px] px-5 py-4 hover:border-sky-300/20 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-base font-medium text-zinc-100 truncate lg:text-lg">{anime.title}</div>
                        <div className="mt-1 text-sm text-zinc-500 truncate">
                          {anime.originalTitle ?? '未补充原名'}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 lg:text-[13px]">
                          <span>{anime.progress} / {anime.totalEpisodes || '?'} EP</span>
                          <span className="h-1 w-1 rounded-full bg-zinc-700" />
                          <span>{formatAnimeWatchState(anime)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <span className="surface-pill rounded-full px-3 py-1.5 text-xs text-zinc-300 lg:text-sm">{statusLabels[anime.status]}</span>
                        {typeof anime.score === 'number' && <span className="text-xs text-zinc-500 lg:text-[13px]">评分 {anime.score.toFixed(1)}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {canExpand && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-4">
                  <div className="text-sm text-zinc-500">
                    {isExpanded ? `当前已展开全部 ${visibleItems.length} 部作品。` : `还有 ${visibleItems.length - renderedItems.length} 部作品未展开。`}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedBuckets((current) => ({
                      ...current,
                      [bucket.key]: !current[bucket.key],
                    }))}
                    className="surface-pill rounded-full px-4 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
                  >
                    {isExpanded ? '收起到前 6 部' : `展开全部 ${visibleItems.length} 部`}
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {!visibleSeasonBuckets.length && (
          <div className="glass-panel rounded-[34px] p-8 text-base text-zinc-500">
            {seasonBuckets.length
              ? '当前筛选下没有符合条件的开播作品。'
              : '暂时还没有可用的首播季度数据。只有 premiereDate 已填写且已经开播的作品，才会出现在这里。'}
          </div>
        )}
      </section>

      {loading && (
        <div className="text-sm text-zinc-500 font-mono px-2">SEASON_NOTEBOOK_LOADING...</div>
      )}
    </main>
  );
}
