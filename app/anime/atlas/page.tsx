"use client";

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowUpRightIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
} from '@heroicons/react/24/outline';
import { useAnimeData } from '@/hooks/useAnimeData';

const distributionColors = ['#7be7ff', '#62f0c2', '#9ae66e', '#f4bf62', '#f08ac2', '#74858a'];
const episodeBucketOrder: Record<string, number> = {
  '1-3 集': 0,
  '4-11 集': 1,
  '12-13 集': 2,
  '14-26 集': 3,
  '27+ 集': 4,
};

function formatPremiere(value?: string) {
  if (!value) return '未补充';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short' }).format(date);
}

function getEpisodeBucketLabel(totalEpisodes?: number) {
  if (!totalEpisodes || totalEpisodes <= 0) {
    return undefined;
  }

  if (totalEpisodes <= 3) return '1-3 集';
  if (totalEpisodes <= 11) return '4-11 集';
  if (totalEpisodes <= 13) return '12-13 集';
  if (totalEpisodes <= 26) return '14-26 集';
  return '27+ 集';
}

type DistributionItem = {
  label: string;
  value: number;
  color: string;
  percentage: number;
};

type TagRow = {
  tag: string;
  count: number;
  percentage: number;
};

function getRelativeBarWidth(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) {
    return '0%';
  }

  return `${(value / maxValue) * 100}%`;
}

function AtlasEpisodeBarList({ data }: { data: DistributionItem[] }) {
  const maxValue = useMemo(() => data.reduce((max, item) => Math.max(max, item.value), 0), [data]);

  if (!data.length) {
    return (
      <div className="surface-card-muted flex h-[220px] items-center justify-center rounded-[24px] text-sm text-zinc-500">
        暂无总集数分布数据
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div key={item.label} className="surface-card-muted rounded-[24px] px-4 py-4 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
            <div className="flex min-w-0 items-center gap-3 lg:w-[250px] lg:shrink-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-xs font-mono text-zinc-400">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-sm text-zinc-100">{item.label}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{item.percentage}% · 共 {item.value} 部作品</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: getRelativeBarWidth(item.value, maxValue),
                    backgroundColor: item.color,
                    boxShadow: `0 0 18px ${item.color}33`,
                  }}
                />
              </div>
            </div>
            <div className="flex items-end gap-2 lg:w-[92px] lg:shrink-0 lg:justify-end">
              <span className="text-2xl font-mono text-zinc-100">{item.value}</span>
              <span className="pb-1 text-xs text-zinc-500">部</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AtlasTagBarList({ data }: { data: TagRow[] }) {
  const maxValue = useMemo(() => data.reduce((max, item) => Math.max(max, item.count), 0), [data]);

  if (!data.length) {
    return (
      <div className="surface-card-muted flex h-[280px] items-center justify-center rounded-[24px] text-sm text-zinc-500">
        暂无标签排行数据
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <Link
          key={item.tag}
          href={`/anime?tag=${encodeURIComponent(item.tag)}`}
          className="theme-secondary-hover-card group block surface-card-muted rounded-[24px] px-4 py-4 transition-all duration-300 hover:bg-white/[0.05] lg:px-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
            <div className="flex min-w-0 items-center gap-3 lg:w-[250px] lg:shrink-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-xs font-mono text-zinc-400">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-zinc-100">{item.tag}</span>
                  <ArrowUpRightIcon className="theme-secondary-hover-text h-3.5 w-3.5 shrink-0 text-zinc-600 transition-colors" />
                </div>
                <div className="mt-1 text-xs text-zinc-500">覆盖 {item.percentage}% · 点击筛选该标签</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="theme-spectrum-gradient h-full rounded-full transition-all duration-500"
                  style={{ width: getRelativeBarWidth(item.count, maxValue) }}
                />
              </div>
            </div>
            <div className="flex items-end gap-2 lg:w-[92px] lg:shrink-0 lg:justify-end">
              <span className="text-2xl font-mono text-zinc-100">{item.count}</span>
              <span className="pb-1 text-xs text-zinc-500">部</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function AnimeAtlasPage() {
  const { animeList, animeTagStats, isLoading: animeLoading } = useAnimeData();

  const data = useMemo(() => {
    const episodeBucketCounts: Record<string, number> = {};
    const castCounts: Record<string, number> = {};

    animeList.forEach((anime) => {
      const episodeBucket = getEpisodeBucketLabel(anime.totalEpisodes);
      if (episodeBucket) {
        episodeBucketCounts[episodeBucket] = (episodeBucketCounts[episodeBucket] || 0) + 1;
      }

      if (Array.isArray(anime.cast)) {
        anime.cast.forEach((name) => {
          const normalized = String(name || '').trim();
          if (!normalized) return;
          castCounts[normalized] = (castCounts[normalized] || 0) + 1;
        });
      }
    });

    const scored = animeList
      .filter((anime) => typeof anime.score === 'number')
      .sort((left, right) => {
        const scoreDiff = (right.score ?? 0) - (left.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return left.title.localeCompare(right.title, 'zh-CN');
      })
      .slice(0, 9);

    const premiered = animeList
      .filter((anime) => anime.premiereDate)
      .sort((left, right) => new Date(right.premiereDate ?? 0).getTime() - new Date(left.premiereDate ?? 0).getTime())
      .slice(0, 6);

    const metadataRichness = animeList.length
      ? Math.round(
          (animeList.filter((anime) => [anime.originalTitle, anime.score, anime.totalEpisodes, Array.isArray(anime.cast) && anime.cast.length > 0 ? 'cast' : '', anime.premiereDate, anime.summary].filter(Boolean).length >= 4).length /
            animeList.length) *
            100
        )
      : 0;

    const sortedEpisodeBuckets = Object.entries(episodeBucketCounts).sort((left, right) => {
      const countDiff = right[1] - left[1];
      if (countDiff !== 0) return countDiff;
      return episodeBucketOrder[left[0]] - episodeBucketOrder[right[0]];
    });

    const episodeTotal = sortedEpisodeBuckets.reduce((sum, [, value]) => sum + value, 0);

    return {
      scored,
      premiered,
      topVoiceActors: Object.entries(castCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8),
      episodeDistribution: sortedEpisodeBuckets
        .map(([label, value], index) => ({
          label,
          value,
          color: distributionColors[index % distributionColors.length],
          percentage: episodeTotal ? Math.round((value / episodeTotal) * 100) : 0,
        })),
      metadataRichness,
    };
  }, [animeList]);

  const loading = animeLoading;
  const tagRows = useMemo<TagRow[]>(() => (
    animeTagStats
      .filter((item) => item.tag.trim().toLowerCase() !== 'tv')
      .slice(0, 10)
      .map((item) => ({
        ...item,
        percentage: animeList.length ? Math.round((item.count / animeList.length) * 100) : 0,
      }))
  ), [animeList.length, animeTagStats]);
  const episodeTotal = data.episodeDistribution.reduce((sum, item) => sum + item.value, 0);
  const dominantEpisodeBucket = data.episodeDistribution[0] ?? null;
  const dominantTag = tagRows[0] ?? null;

  return (
    <main className="p-4 lg:p-8 pb-24 space-y-6 lg:space-y-8 animate-fade-in relative">
      <div className="theme-atlas-aura absolute inset-0 pointer-events-none opacity-40" />

      <section className="glass-panel-strong rounded-[36px] p-8 lg:p-10 relative overflow-hidden">
        <div className="theme-atlas-hero-aura absolute inset-0" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4 max-w-3xl">
            <Link href="/" className="inline-flex items-center gap-1 text-zinc-400 hover:text-white text-sm transition-colors">
              <ChevronLeftIcon className="w-4 h-4" /> 返回总览
            </Link>
            <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-zinc-50">作品元数据图谱</h1>
            <p className="text-sm md:text-base text-zinc-400 leading-7">
              这里专门展示你的片库由哪些集数层级、声优排行、标签和作品评分构成。比起首页，它更偏向“片库剖面图”。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-full lg:min-w-[320px] lg:max-w-[360px]">
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Library</div>
              <div className="mt-2 text-2xl font-mono text-zinc-100">{animeList.length}</div>
              <div className="text-xs text-zinc-500 mt-1">当前入库作品</div>
            </div>
            <div className="surface-card rounded-[24px] p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Richness</div>
              <div className="theme-accent-text mt-2 text-2xl font-mono">{data.metadataRichness}%</div>
              <div className="text-xs text-zinc-500 mt-1">档案完整度</div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 space-y-6">
        <div className="glass-panel rounded-[32px] p-6 lg:p-7">
          <div className="flex flex-col gap-4 border-b border-white/6 pb-5 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3">
              <SparklesIcon className="theme-accent-text w-5 h-5" />
              <div>
                <h2 className="text-xl font-display font-semibold text-zinc-100">集数分布</h2>
                <p className="mt-1 text-sm text-zinc-500">改为全宽横向条形图，直接比较各集数区间的体量差。</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-300">
              <div>
                <span className="text-zinc-500">已统计</span>
                <span className="ml-2 font-mono text-zinc-100">{episodeTotal}</span>
              </div>
              <div>
                <span className="text-zinc-500">最高区间</span>
                <span className="ml-2 text-zinc-100">{dominantEpisodeBucket?.label ?? '暂无'}</span>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <AtlasEpisodeBarList data={data.episodeDistribution} />
          </div>
        </div>

        <div className="glass-panel rounded-[32px] p-6 lg:p-7">
          <div className="flex flex-col gap-4 border-b border-white/6 pb-5 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3">
              <TagIcon className="theme-secondary-text w-5 h-5" />
              <div>
                <h2 className="text-xl font-display font-semibold text-zinc-100">标签排行</h2>
                <p className="mt-1 text-sm text-zinc-500">横向拉满主容器，每个标签都可以直接跳到番剧列表筛选。</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-300">
              <div>
                <span className="text-zinc-500">展示范围</span>
                <span className="ml-2 text-zinc-100">前 {tagRows.length} 标签</span>
              </div>
              <div>
                <span className="text-zinc-500">已过滤</span>
                <span className="ml-2 text-zinc-100">TV</span>
              </div>
              <div>
                <span className="text-zinc-500">首位标签</span>
                <span className="ml-2 text-zinc-100">{dominantTag?.tag ?? '暂无'}</span>
              </div>
              <Link
                href={dominantTag ? `/anime?tag=${encodeURIComponent(dominantTag.tag)}` : '/anime'}
                className="theme-secondary-text inline-flex items-center gap-1.5 transition-colors hover:text-white"
              >
                查看标签作品
                <ArrowUpRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="mt-5">
            <AtlasTagBarList data={tagRows} />
          </div>
          {tagRows.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {tagRows.map((tag) => (
                <Link
                  key={tag.tag}
                  href={`/anime?tag=${encodeURIComponent(tag.tag)}`}
                  className="text-zinc-400 transition-colors theme-secondary-hover-text"
                >
                  #{tag.tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 relative z-10">
        <div className="xl:col-span-7 glass-panel rounded-[32px] p-6 lg:p-8">
          <div className="flex items-center gap-3 mb-6">
            <StarIcon className="w-5 h-5 text-amber-300" />
            <h2 className="text-xl font-display font-semibold text-zinc-100">作品评分</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.scored.map((anime, index) => (
              <Link key={anime.id} href={`/anime/${anime.id}`} className="group surface-card-muted rounded-[28px] overflow-hidden hover:border-amber-300/20 transition-all duration-300">
                <div className="h-40 bg-zinc-900/70 bg-cover bg-center" style={anime.coverUrl ? { backgroundImage: `linear-gradient(180deg, rgba(7,17,15,0.05), rgba(7,17,15,0.9)), url(${anime.coverUrl})` } : undefined} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Rank #{index + 1}</div>
                      <div className="mt-1 text-lg text-zinc-100 truncate">{anime.title}</div>
                      <div className="text-xs text-zinc-500 truncate">{anime.originalTitle ?? '未补充原名'}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-sm text-amber-100">
                      {anime.score?.toFixed(1)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {!data.scored.length && <div className="text-sm text-zinc-500">评分字段还不够丰富，之后可以继续补齐。</div>}
          </div>
        </div>

        <div className="xl:col-span-5 space-y-6">
          <div className="glass-panel rounded-[32px] p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-6">
              <TagIcon className="w-5 h-5 text-violet-300" />
              <h2 className="text-xl font-display font-semibold text-zinc-100">声优排行</h2>
            </div>
            <div className="space-y-2.5">
              {data.topVoiceActors.map(([name, count], index) => (
                <div key={name} className="surface-card-muted rounded-[18px] px-4 py-3 text-sm text-zinc-300">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[11px] font-mono text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="truncate">{name}</span>
                    </div>
                    <span className="text-zinc-500 shrink-0">{count} 部</span>
                  </div>
                </div>
              ))}
              {!data.topVoiceActors.length && <div className="text-sm text-zinc-500">声优信息还没有形成排行。</div>}
            </div>
          </div>

          <div className="glass-panel rounded-[32px] p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-6">
              <CalendarDaysIcon className="w-5 h-5 text-sky-300" />
              <h2 className="text-xl font-display font-semibold text-zinc-100">追番列表中最近开播作品</h2>
            </div>
            <div className="space-y-3">
              {data.premiered.map((anime) => (
                <Link key={anime.id} href={`/anime/${anime.id}`} className="group surface-card-muted flex items-center justify-between gap-3 rounded-[20px] px-4 py-3 hover:border-sky-300/20 transition-all">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-200 truncate">{anime.title}</div>
                    <div className="text-xs text-zinc-500 truncate">{formatPremiere(anime.premiereDate)} · {anime.totalEpisodes ? `${anime.totalEpisodes} 集` : '集数未补充'}</div>
                  </div>
                  <ArrowUpRightIcon className="w-4 h-4 text-zinc-600 group-hover:text-sky-300 transition-colors" />
                </Link>
              ))}
              {!data.premiered.length && <div className="text-sm text-zinc-500">首播日期字段暂时较少。</div>}
            </div>
          </div>
        </div>
      </section>

      {loading && (
        <div className="text-sm text-zinc-500 font-mono px-2">ATLAS_LOADING...</div>
      )}
    </main>
  );
}