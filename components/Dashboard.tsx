'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import {
    ArrowTrendingUpIcon,
    CalendarDaysIcon,
    ClockIcon,
    FireIcon,
    SparklesIcon,
    TvIcon,
} from '@heroicons/react/24/outline';
import { useAnimeData } from '@/hooks/useAnimeData';
import { useHistoryData } from '@/hooks/useHistoryData';
import { useTheme } from '@/components/theme/ThemeProvider';
import { AnimeRecord } from '@/lib/dashboard-types';
import { formatPremiere, formatUpdateDate, formatWatchMoment } from '@/lib/formatters';
import { getAppThemeDefinition } from '@/lib/theme';
import DashboardHeader from './dashboard/DashboardHeader';
import LazyRender from './shared/LazyRender';

// 动态导入组件，减少初始包体积
const YearBarChart = dynamic(() => import('./dashboard/YearBarChart').then(mod => mod.YearBarChart), { ssr: false });
const ActivityFeed = dynamic(() => import('./dashboard/ActivityFeed'), { ssr: false });
const AdvancedActivityStats = dynamic(() => import('./dashboard/AdvancedActivityStats'), { ssr: false });

export default function Dashboard() {
    const { theme } = useTheme();
    const themeDefinition = getAppThemeDefinition(theme);
    const { parsedHistory, isLoading: hLoading, isRefreshing: hRefreshing } = useHistoryData();
    const {
        animeList,
        animeStats,
        animeTagStats,
        animeCompletionRate,
        isLoading: aLoading,
        isRefreshing: aRefreshing,
    } = useAnimeData(parsedHistory);

    // 聚合加载状态
    const isLoading = aLoading || hLoading;
    const isRefreshing = aRefreshing || hRefreshing;

    const { weeklyEpisodes } = useMemo(() => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setHours(0, 0, 0, 0);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const recentEpisodes = parsedHistory.filter((h) => h.dateObj >= sevenDaysAgo).length;

        return {
            weeklyEpisodes: recentEpisodes,
        };
    }, [parsedHistory]);

    const stats = [
        {
            label: '追番总数',
            value: animeStats.count.toString(),
            unit: '部',
            icon: TvIcon,
            color: 'theme-accent-text',
            href: '/anime',
        },
        {
            label: '当前追番',
            value: (animeStats.byStatus.watching || 0).toString(),
            unit: '部',
            icon: FireIcon,
            color: 'text-amber-300',
            href: '/anime?status=watching',
        },
        {
            label: '本周观看',
            value: weeklyEpisodes.toString(),
            unit: '集',
            icon: ClockIcon,
            color: 'text-sky-300',
            href: '/anime/timeline',
        },
        {
            label: '看番总时长',
            value: Math.round(animeStats.minutesWatched / 60).toString(),
            unit: '小时',
            prefix: '约',
            icon: ArrowTrendingUpIcon,
            color: 'theme-secondary-text',
        },
    ];

    const recentPremiered = useMemo(() => {
        return [...animeList]
            .filter((anime) => anime.premiereDate)
            .sort((left, right) => new Date(right.premiereDate ?? 0).getTime() - new Date(left.premiereDate ?? 0).getTime())
            .slice(0, 6);
    }, [animeList]);

    const heroAnime = useMemo(() => {
        if (parsedHistory.length) {
            const animeMap = new Map(animeList.map((anime) => [anime.id, anime]));
            const sorted = [...parsedHistory].sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
            for (const record of sorted) {
                const anime = animeMap.get(record.animeId);
                if (anime) return anime;
            }
        }
        return animeList[0] ?? null;
    }, [animeList, parsedHistory]);

    const recentWatching = useMemo(() => {
        const animeMap = new Map(animeList.map((anime) => [anime.id, anime]));
        const seenAnimeIds = new Set<number>();
        const uniqueItems: Array<{ record: (typeof parsedHistory)[number]; anime?: AnimeRecord }> = [];

        for (const record of [...parsedHistory].sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())) {
            if (seenAnimeIds.has(record.animeId)) continue;
            seenAnimeIds.add(record.animeId);
            uniqueItems.push({
                record,
                anime: animeMap.get(record.animeId),
            });
            if (uniqueItems.length >= 9) break;
        }

        return uniqueItems;
    }, [animeList, parsedHistory]);

    const heroStyle = heroAnime?.coverUrl
        ? {
            backgroundImage: `${themeDefinition.heroOverlay}, url(${heroAnime.coverUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }
        : undefined;

    const metadataCoverage = useMemo(() => {
        const total = animeList.length || 1;
        const fields = [
            { label: '原名', count: animeList.filter((anime) => Boolean(anime.originalTitle)).length },
            { label: '评分', count: animeList.filter((anime) => typeof anime.score === 'number').length },
            { label: '集数', count: animeList.filter((anime) => typeof anime.totalEpisodes === 'number' && anime.totalEpisodes > 0).length },
            { label: '声优', count: animeList.filter((anime) => Array.isArray(anime.cast) && anime.cast.length > 0).length },
            { label: '首播', count: animeList.filter((anime) => Boolean(anime.premiereDate)).length },
            { label: '简介', count: animeList.filter((anime) => Boolean(anime.summary)).length },
        ];

        return fields.map((field) => ({
            ...field,
            percent: Math.round((field.count / total) * 100),
        }));
    }, [animeList]);

    const metadataRichness = useMemo(() => {
        if (!animeList.length) return 0;
        const count = animeList.filter((anime) => {
            const filled = [
                anime.originalTitle,
                anime.score,
                anime.totalEpisodes,
                Array.isArray(anime.cast) && anime.cast.length > 0 ? anime.cast.join(',') : undefined,
                anime.premiereDate,
                anime.summary,
            ].filter((value) => value !== undefined && value !== null && value !== '');
            return filled.length >= 4;
        }).length;

        return Math.round((count / animeList.length) * 100);
    }, [animeList]);

    const premiereByYear = useMemo(() => {
        const yearCount = new Map<number, number>();

        animeList.forEach((anime) => {
            if (!anime.premiereDate) return;
            const date = new Date(anime.premiereDate);
            if (Number.isNaN(date.getTime())) return;
            const year = date.getFullYear();
            yearCount.set(year, (yearCount.get(year) || 0) + 1);
        });

        return Array.from(yearCount.entries())
            .sort((left, right) => left[0] - right[0])
            .slice(-20)
            .map(([year, count]) => ({ year, count }));
    }, [animeList]);

    const premierePieData = useMemo(
        () => premiereByYear.map((item, i) => ({
            label: `${item.year} 年`,
            value: item.count,
            color: themeDefinition.premierePalette[i % themeDefinition.premierePalette.length],
        })),
        [premiereByYear, themeDefinition]
    );

    const tagBarData = useMemo(() => animeTagStats.slice(0, 8), [animeTagStats]);
    const tagBarMax = tagBarData.reduce((max, item) => Math.max(max, item.count), 1);

    return (
        <div className="p-4 lg:p-8 space-y-4 lg:space-y-6 animate-fade-in pb-20 relative">
            <div className="theme-dashboard-aura absolute inset-0 pointer-events-none opacity-40" />

            <DashboardHeader isLoading={isLoading} isRefreshing={isRefreshing} />

            <LazyRender fallback={<div className="glass-panel-strong rounded-[34px] h-[330px] animate-pulse" />}>
                <section className="glass-panel-strong rounded-[36px] p-7 lg:p-10 relative overflow-hidden">
                    {heroStyle && <div className="absolute inset-0 opacity-60" style={heroStyle} />}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_42%)]" />

                    <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8">
                        <div className="xl:col-span-8 space-y-5">
                            <h2 className="text-2xl md:text-4xl font-display font-semibold tracking-tight text-zinc-50 leading-tight">
                                我的番剧
                                <span className="block text-zinc-300 text-base md:text-xl mt-3 font-normal">
                                    记录、评分和元数据，全都在这里。
                                </span>
                            </h2>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                                <div className="surface-card rounded-[20px] px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">馆藏总量</div>
                                    <div className="mt-1 text-2xl font-mono text-zinc-100">{animeStats.count}</div>
                                </div>
                                <div className="surface-card rounded-[20px] px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">档案完整度</div>
                                    <div className="theme-accent-text mt-1 text-2xl font-mono">{metadataRichness}%</div>
                                </div>
                                <div className="surface-card rounded-[20px] px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">完结率</div>
                                    <div className="theme-secondary-text mt-1 text-2xl font-mono">{animeCompletionRate}%</div>
                                </div>
                                <div className="surface-card rounded-[20px] px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">本周观看</div>
                                    <div className="mt-1 text-2xl font-mono text-amber-300">{weeklyEpisodes} 集</div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 pt-1">
                                <Link href="/anime" className="theme-accent-soft rounded-full px-4 py-2 text-sm transition-all">
                                    进入番剧列表
                                </Link>
                                <Link href="/anime/atlas" className="theme-secondary-soft rounded-full px-4 py-2 text-sm transition-all">
                                    打开图谱馆
                                </Link>
                                <Link href="/anime/seasons" className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm text-amber-100 hover:bg-amber-300/15 transition-all">
                                    查看档期簿
                                </Link>
                            </div>
                        </div>

                        <div className="xl:col-span-4 surface-card rounded-[30px] p-5 lg:p-6 backdrop-blur-md">
                            <div className="text-[10px] text-zinc-500">最近在看</div>
                            {heroAnime ? (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <h3 className="text-2xl font-display text-zinc-100 leading-snug">{heroAnime.title}</h3>
                                        <p className="text-sm text-zinc-400 mt-1 truncate">{heroAnime.originalTitle ?? '尚未补充原名'}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="surface-card-muted rounded-2xl p-3">
                                            <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">评分</div>
                                            <div className="mt-1 text-xl text-amber-200 font-mono">
                                                {typeof heroAnime.score === 'number' ? heroAnime.score.toFixed(1) : '未补充'}
                                            </div>
                                        </div>
                                        <div className="surface-card-muted rounded-2xl p-3">
                                            <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">首播</div>
                                            <div className="mt-1 text-xl text-sky-200 font-mono">{formatPremiere(heroAnime.premiereDate)}</div>
                                        </div>
                                    </div>
                                    <div className="text-xs text-zinc-400 leading-6 line-clamp-3">
                                        {heroAnime.summary ?? '这部作品还没有补充摘要。可以在详情页使用 AI 补充，首页会自动展示更丰富信息。'}
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-zinc-500">
                                        <span>最近编辑</span>
                                        <span>{formatUpdateDate(heroAnime.updatedAt)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 text-sm text-zinc-500">暂无作品数据，先去片库添加第一部番剧吧。</div>
                            )}
                        </div>
                    </div>
                </section>
            </LazyRender>

            <LazyRender
                fallback={
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="glass-panel rounded-[24px] h-28 animate-pulse" />
                        ))}
                    </div>
                }
            >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10 cv-auto">
                    {stats.map((stat, i) => {
                        const content = (
                            <>
                                {/* 背景装饰图标 */}
                                <div className="absolute -bottom-3 -right-3 opacity-[0.06] group-hover:opacity-[0.14] transition-all duration-500 scale-150 group-hover:rotate-12 pointer-events-none">
                                    <stat.icon className={`w-20 h-20 ${stat.color}`} />
                                </div>

                                <div className="flex items-start relative z-10">
                                    <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${stat.color}`}>
                                        <stat.icon className="w-4 h-4" />
                                    </div>
                                </div>

                                <div className="relative z-10">
                                    <div className="flex items-baseline gap-1.5">
                                        {stat.prefix ? (
                                            <span className="text-sm font-semibold tracking-[0.18em] text-zinc-400">
                                                {stat.prefix}
                                            </span>
                                        ) : null}
                                        <span className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">
                                            {stat.value}
                                        </span>
                                        <span className="text-xs text-zinc-500 font-bold uppercase tracking-tighter">{stat.unit}</span>
                                    </div>
                                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.18em] mt-0.5 group-hover:text-zinc-400 transition-colors">
                                        {stat.label}
                                    </div>
                                </div>
                            </>
                        );

                        const className = "glass-panel surface-card-muted px-5 py-5 rounded-[28px] transition-all duration-500 hover:-translate-y-1 group relative overflow-hidden flex flex-col gap-4";

                        return stat.href ? (
                            <Link
                                key={i}
                                href={stat.href}
                                className={className}
                            >
                                {content}
                            </Link>
                        ) : (
                            <div
                                key={i}
                                className={className}
                            >
                                {content}
                            </div>
                        );
                    })}
                </div>
            </LazyRender>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 relative z-10">
                {/* 左列（主列） */}
                <div className="lg:col-span-8 flex flex-col gap-4 lg:gap-5">
                    <LazyRender fallback={<div className="glass-panel rounded-[32px] h-96 animate-pulse" />}>
                        <div className="glass-panel p-6 lg:p-7 rounded-[32px] bg-gradient-to-br from-zinc-900/40 via-transparent to-transparent min-h-[420px]">
                            <AdvancedActivityStats history={parsedHistory} animeList={animeList} />
                        </div>
                    </LazyRender>

                    <LazyRender fallback={<div className="glass-panel rounded-[32px] h-[300px] animate-pulse" />}>
                        <div className="glass-panel p-6 lg:p-7 rounded-[32px] flex flex-col overflow-visible">
                            <div className="flex items-center gap-2 mb-1">
                                <CalendarDaysIcon className="w-4 h-4 text-sky-300" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">作品开播时间分布</h2>
                            </div>
                            <p className="text-[10px] text-zinc-600 mb-2">基于每部作品的开播日期字段统计</p>
                            {premierePieData.length > 0 ? (
                                <div className="flex-1 w-full min-h-[220px] mt-2 pb-2">
                                    <YearBarChart data={premierePieData} height={220} />
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center">
                                    <div className="text-sm text-zinc-500">开播日期字段还不够多，先在详情页补全几部作品即可生成分布。</div>
                                </div>
                            )}
                        </div>
                    </LazyRender>

                    <div className="glass-panel p-6 lg:p-7 rounded-[32px] flex flex-col">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                                <ClockIcon className="w-4 h-4 text-sky-300" />
                                最近在看作品
                            </h2>
                            <Link href="/anime/timeline" className="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest">
                                查看时间线
                            </Link>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4 auto-rows-max content-start pr-1">
                            {recentWatching.map(({ record, anime }) => (
                                <Link
                                    key={`recent-${record.id}`}
                                    href={`/anime/${record.animeId}`}
                                    className="group surface-card-muted rounded-[22px] overflow-hidden hover:border-sky-300/20 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01]"
                                >
                                    <div
                                        className="aspect-video w-full bg-zinc-900/70 bg-cover bg-center"
                                        style={anime?.coverUrl ? { backgroundImage: `linear-gradient(180deg, rgba(7,17,15,0.1), rgba(7,17,15,0.9)), url(${anime.coverUrl})` } : undefined}
                                    />
                                    <div className="p-4">
                                        <div className="mt-1 text-base text-zinc-100 truncate">{anime?.title ?? record.animeTitle}</div>
                                        <div className="text-xs text-zinc-500 truncate">{anime?.originalTitle ?? '来自观看历史'}</div>
                                        <div className="mt-3 flex items-center justify-between gap-2">
                                            <span className="inline-flex rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-[11px] text-sky-100">
                                                第 {record.episode} 集
                                            </span>
                                            <span className="text-[11px] text-zinc-500 font-mono">{formatWatchMoment(record.dateObj)}</span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                            {Array.from({ length: Math.max(0, 9 - recentWatching.length) }).map((_, index) => (
                                <div
                                    key={`recent-empty-${index}`}
                                    className="surface-card-muted rounded-[22px] overflow-hidden"
                                >
                                    <div className="aspect-video bg-gradient-to-br from-white/[0.04] to-transparent" />
                                    <div className="p-4">
                                        <div className="mt-2 text-sm text-zinc-500">最近看得太少啦~</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 右列（副列） */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:gap-5">
                    <LazyRender fallback={<div className="glass-panel rounded-[32px] h-64 animate-pulse" />}>
                        <div className="glass-panel p-5 rounded-[28px] space-y-4">
                            <div className="flex items-center gap-2">
                                <SparklesIcon className="theme-accent-text w-4 h-4" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">元数据完整度</h2>
                            </div>
                            <div className="space-y-2.5">
                                {metadataCoverage.map((item) => (
                                    <div key={item.label} className="space-y-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-zinc-400 uppercase tracking-[0.22em]">{item.label}</span>
                                            <span className="text-zinc-500">{item.percent}%</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                            <div
                                                className="theme-accent-gradient h-full rounded-full"
                                                style={{ width: `${item.percent}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="theme-accent-soft rounded-[18px] p-3">
                                <div className="theme-accent-text-muted text-[10px]">完整度指数</div>
                                <div className="theme-accent-text mt-1.5 text-xl font-mono">{metadataRichness}%</div>
                                <p className="mt-1 text-xs text-zinc-300 leading-5">具备 4 项以上核心字段的作品占比。值越高，图谱页和首页越完整。</p>
                            </div>
                        </div>
                    </LazyRender>

                    <div className="glass-panel p-6 lg:p-7 rounded-[32px]">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2 mb-5">
                            <span className="theme-switch-dot h-2 w-2 rounded-full" />
                            观看统计与偏好
                        </h2>

                        <div className="surface-card-muted rounded-[24px] p-5">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">标签分布</h3>
                                <span className="text-[10px] text-zinc-600">条形图</span>
                            </div>

                            <div className="space-y-3">
                                {tagBarData.map((item) => (
                                    <div key={`tag-${item.tag}`} className="rounded-xl px-2 py-1.5 transition-all duration-200 hover:scale-[1.01] hover:bg-white/[0.02]">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-zinc-300 truncate">{item.tag}</span>
                                            <span className="text-xs text-zinc-500 font-mono flex-shrink-0">{item.count} 部</span>
                                        </div>
                                        <div className="mt-1.5 h-1.5 w-full bg-white/6 rounded-full overflow-hidden">
                                            <div
                                                className="theme-accent-gradient h-full rounded-full transition-all duration-300"
                                                style={{ width: `${(item.count / tagBarMax) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {!tagBarData.length && <div className="text-sm text-zinc-500">标签数据还在累计中。</div>}
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-7 rounded-[32px] flex-shrink-0">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2 mb-5">
                            <CalendarDaysIcon className="w-4 h-4 text-sky-300" />
                            最近开播作品
                        </h2>
                        <div className="space-y-3">
                            {recentPremiered.map((anime) => (
                                <Link key={anime.id} href={`/anime/${anime.id}`} className="group surface-card-muted flex items-center justify-between gap-3 rounded-[20px] px-4 py-3 hover:border-sky-300/20 transition-all">
                                    <div className="min-w-0">
                                        <div className="text-sm text-zinc-200 truncate">{anime.title}</div>
                                        <div className="text-xs text-zinc-500 truncate">{formatPremiere(anime.premiereDate)} · {anime.totalEpisodes ? `${anime.totalEpisodes} 集` : '集数未补充'}</div>
                                    </div>
                                    <span className="text-[10px] text-zinc-500 group-hover:text-sky-200">↗</span>
                                </Link>
                            ))}
                            {!recentPremiered.length && <div className="text-sm text-zinc-500">开播字段偏少，暂时没有可展示列表。</div>}
                        </div>
                    </div>

                    <div className="glass-panel p-6 lg:p-7 rounded-[32px] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between mb-5 flex-shrink-0">
                            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
                                最近记录
                            </h2>
                            <Link href="/anime/timeline" className="text-[10px] font-bold text-zinc-600 hover:text-white transition-colors">查看全部</Link>
                        </div>
                        <div className="max-h-[480px] lg:max-h-[430px] xl:max-h-[380px] overflow-y-auto pr-2 overscroll-contain">
                            <ActivityFeed history={parsedHistory} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
