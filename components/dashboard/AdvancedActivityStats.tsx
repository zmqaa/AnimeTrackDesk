
"use client";

import { memo, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { AnimeRecord, ParsedWatchHistory } from '@/lib/dashboard-types';
import { graphic, ReactECharts } from './echarts';

export default memo(function AdvancedActivityStats({ history, animeList }: { history: ParsedWatchHistory[], animeList: AnimeRecord[] }) {
    const [scale, setScale] = useState<'week' | 'month' | 'year'>('week');

    const statsData = useMemo(() => {
        const now = new Date();
        const data: { label: string; value: number }[] = [];
        let totalEpisodes = 0;
        let totalMinutes = 0;
        let title = "";
        let scaleStart = new Date(now);

        const historyMap: Record<string, number> = {};
        history.forEach(h => {
            historyMap[h.dateStr] = (historyMap[h.dateStr] || 0) + 1;
        });

        if (scale === 'week') {
            title = "过去 7 日趋势";
            scaleStart.setHours(0, 0, 0, 0);
            scaleStart.setDate(scaleStart.getDate() - 6);
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(now.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const count = historyMap[dateStr] || 0;
                totalEpisodes += count;
                data.push({ label: d.toLocaleDateString('zh-CN', { weekday: 'short' }), value: count });
            }
        } else if (scale === 'month') {
            title = "本月每日趋势";
            const year = now.getFullYear();
            const month = now.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            scaleStart = new Date(year, month, 1);
            
            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                const count = historyMap[dateStr] || 0;
                totalEpisodes += count;
                data.push({ label: `${i}`, value: count });
            }
        } else {
            title = "年度每月趋势";
            const year = now.getFullYear();
            const monthlyMap: Record<string, number> = {};
            scaleStart = new Date(year, 0, 1);
            
            history.forEach(h => {
                if (h.year === year) {
                    const monthKey = `${h.year}-${String(h.month + 1).padStart(2, '0')}`;
                    monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + 1;
                }
            });

            for (let i = 0; i < 12; i++) {
                const monthKey = `${year}-${String(i + 1).padStart(2, '0')}`;
                const count = monthlyMap[monthKey] || 0;
                totalEpisodes += count;
                data.push({ label: `${i + 1}月`, value: count });
            }
        }

        totalMinutes = totalEpisodes * 24; 

        const scopedHistory = history.filter((item) => item.dateObj >= scaleStart);
        const activeWindows = {
            凌晨: 0,
            日间: 0,
            黄昏: 0,
            深夜: 0,
        };

        scopedHistory.forEach((item) => {
            if (item.hour < 6) activeWindows.凌晨 += 1;
            else if (item.hour < 14) activeWindows.日间 += 1;
            else if (item.hour < 20) activeWindows.黄昏 += 1;
            else activeWindows.深夜 += 1;
        });

        const mostActiveWindow = Object.entries(activeWindows).sort((a, b) => b[1] - a[1])[0] ?? ['暂无', 0];
        const peakPoint = data.reduce((peak, point) => point.value > peak.value ? point : peak, { label: '暂无', value: 0 });
        const activeDays = data.filter((point) => point.value > 0).length;
        const knownEpisodes = animeList.reduce((sum, anime) => sum + (anime.totalEpisodes ?? anime.progress), 0);
        const libraryCoverage = knownEpisodes > 0 ? Math.min(100, Math.round((totalEpisodes / knownEpisodes) * 100)) : 0;

        return { data, totalEpisodes, totalMinutes, title, peakPoint, activeDays, mostActiveWindow, libraryCoverage };
    }, [animeList, history, scale]);

    const maxValue = Math.max(...statsData.data.map(d => d.value), 1);
    const averagePerUnit = scale === 'week' ? 7 : scale === 'month' ? 30 : 365;
    const chartOption = useMemo<EChartsOption>(() => ({
        animationDuration: 500,
        animationEasing: 'cubicOut',
        grid: {
            left: 34,
            right: 12,
            top: 24,
            bottom: scale === 'month' ? 30 : 18,
            containLabel: true,
        },
        tooltip: {
            trigger: 'axis',
            appendToBody: true,
            confine: false,
            backgroundColor: 'rgba(8, 14, 13, 0.96)',
            borderColor: 'rgba(125, 211, 252, 0.28)',
            borderWidth: 1,
            textStyle: {
                color: '#e5f7ff',
                fontFamily: 'var(--font-body), sans-serif',
                fontSize: 12,
            },
            extraCssText: 'box-shadow: 0 18px 40px rgba(0,0,0,0.38); border-radius: 14px; padding: 10px 12px;',
            axisPointer: {
                type: 'shadow',
                shadowStyle: {
                    color: 'rgba(93, 214, 242, 0.08)',
                    borderRadius: 16,
                },
            },
            formatter: (params: unknown) => {
                const point = Array.isArray(params) ? params[0] as { axisValueLabel: string; data: number } : null;
                if (!point) return '';
                return [
                    `<div style="font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#7dd3fc; opacity:0.9;">${statsData.title}</div>`,
                    `<div style="margin-top:6px; display:flex; align-items:flex-end; gap:8px;">`,
                    `<span style="font-size:22px; line-height:1; font-weight:600; color:#f8fafc;">${point.data}</span>`,
                    `<span style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#a5f3fc;">EP</span>`,
                    `</div>`,
                    `<div style="margin-top:4px; color:#cbd5e1;">${point.axisValueLabel}</div>`,
                ].join('');
            },
        },
        xAxis: {
            type: 'category',
            data: statsData.data.map((item) => item.label),
            boundaryGap: true,
            axisTick: { show: false },
            axisLine: {
                lineStyle: {
                    color: 'rgba(255,255,255,0.08)',
                },
            },
            axisLabel: {
                color: '#7c8a86',
                fontSize: 10,
                margin: 12,
                interval: scale === 'month' ? 4 : 0,
            },
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            splitNumber: 3,
            max: maxValue < 4 ? 4 : undefined,
            axisLabel: {
                color: '#6b7b76',
                fontSize: 10,
            },
            axisTick: { show: false },
            axisLine: { show: false },
            splitLine: {
                lineStyle: {
                    color: 'rgba(255,255,255,0.07)',
                    type: 'dashed',
                },
            },
        },
        series: [
            {
                type: 'line',
                smooth: 0.4,
                data: statsData.data.map((item) => item.value),
                symbol: 'circle',
                symbolSize: 6,
                showSymbol: true,
                lineStyle: {
                    width: 2.5,
                    color: new graphic.LinearGradient(1, 0, 0, 0, [
                        { offset: 0, color: '#c084fc' },
                        { offset: 1, color: '#818cf8' },
                    ]),
                    shadowBlur: 8,
                    shadowColor: 'rgba(192,132,252,0.4)',
                },
                itemStyle: {
                    color: '#c084fc',
                    borderColor: '#0d1117',
                    borderWidth: 2,
                },
                areaStyle: {
                    color: new graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(192,132,252,0.28)' },
                        { offset: 0.55, color: 'rgba(129,140,248,0.08)' },
                        { offset: 1, color: 'rgba(109,40,217,0)' },
                    ]),
                },
                emphasis: {
                    itemStyle: {
                        color: '#e9d5ff',
                        borderColor: '#fff',
                        borderWidth: 2,
                        shadowBlur: 12,
                        shadowColor: 'rgba(196,181,253,0.6)',
                    },
                    scale: true,
                },
            },
        ],
    }), [maxValue, scale, statsData.data, statsData.title]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                     <h2 className="text-2xl font-display font-semibold flex items-center gap-3 text-zinc-100">
                        <span className="w-1.5 h-8 bg-gradient-to-b from-cyan-300 to-blue-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,0.5)]"></span>
                        观影趋势分析
                    </h2>
                    <p className="text-sm text-zinc-400 mt-2 leading-6">{statsData.title}，现在会额外给出高频观看时段和这一段时间对整库的推进占比。</p>
                </div>
                
                <div className="surface-card-muted flex p-1.5 rounded-2xl shadow-xl self-start lg:self-auto">
                    {(['week', 'month', 'year'] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setScale(s)}
                            className={`px-4 py-1.5 rounded-xl text-xs font-bold uppercase transition-all ${scale === s ? 'bg-zinc-800 text-primary shadow-lg ring-1 ring-white/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            {s === 'week' ? '周' : s === 'month' ? '月' : '年'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="surface-card-muted grid grid-cols-2 xl:grid-cols-4 divide-x divide-white/[0.06] rounded-2xl px-1 py-3">
                <div className="flex flex-col gap-1 px-5 first:pl-0">
                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">总看番集数</span>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono text-zinc-100 tracking-tighter">{statsData.totalEpisodes}</span>
                        <span className="text-xs text-zinc-500 font-bold">EP</span>
                    </div>
                </div>
                <div className="flex flex-col gap-1 px-5">
                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">预估时长</span>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono text-blue-400 tracking-tighter">{Math.round(statsData.totalMinutes / 60)}</span>
                        <span className="text-xs text-zinc-500 font-bold">HRS</span>
                    </div>
                </div>
                <div className="flex flex-col gap-1 px-5">
                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">活跃效率</span>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono text-green-400 tracking-tighter">{(statsData.totalEpisodes / averagePerUnit).toFixed(1)}</span>
                        <span className="text-xs text-zinc-500 font-bold">EP/D</span>
                    </div>
                </div>
                <div className="flex flex-col gap-1 px-5">
                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">高频时段</span>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-amber-300 tracking-tight">{statsData.mostActiveWindow[0]}</span>
                        <span className="text-[10px] text-zinc-600 pb-0.5">× {statsData.mostActiveWindow[1]}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-5">
                <div className="surface-card h-[320px] rounded-[28px] bg-[linear-gradient(180deg,rgba(8,14,13,0.66),rgba(7,11,11,0.3))] p-4 md:p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Viewer Activity</div>
                        <div className="hidden md:flex rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-violet-200/75">
                            {scale === 'week' ? '7 Day Window' : scale === 'month' ? 'Monthly Timeline' : 'Yearly Timeline'}
                        </div>
                    </div>
                    <ReactECharts
                        option={chartOption}
                        notMerge
                        lazyUpdate
                        opts={{ renderer: 'svg' }}
                        style={{ height: '250px', width: '100%' }}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 xl:flex xl:flex-col gap-2 xl:h-64">
                    <div className="surface-card-muted flex-1 px-4 py-3 flex flex-col justify-between border-l border-white/[0.06] rounded-xl">
                        <div className="text-[9px] uppercase tracking-[0.3em] text-zinc-600">Peak Point</div>
                        <div className="flex items-end justify-between gap-2">
                            <span className="text-xl font-display text-zinc-100 leading-tight">{statsData.peakPoint.label}</span>
                            <span className="text-[10px] text-zinc-500 font-mono pb-0.5">max {statsData.peakPoint.value} EP</span>
                        </div>
                    </div>
                    <div className="surface-card-muted flex-1 px-4 py-3 flex flex-col justify-between border-l border-white/[0.06] rounded-xl">
                        <div className="text-[9px] uppercase tracking-[0.3em] text-zinc-600">Active Days</div>
                        <div className="flex items-end justify-between gap-2">
                            <span className="text-xl font-mono text-emerald-300">{statsData.activeDays}</span>
                            <span className="text-[10px] text-zinc-500 pb-0.5">有记录天</span>
                        </div>
                    </div>
                    <div className="surface-card-muted flex-1 px-4 py-3 flex flex-col justify-between border-l border-white/[0.06] rounded-xl">
                        <div className="text-[9px] uppercase tracking-[0.3em] text-zinc-600">Library Cov.</div>
                        <div className="flex items-end justify-between gap-2">
                            <span className="text-xl font-mono text-cyan-300">{statsData.libraryCoverage}%</span>
                            <span className="text-[10px] text-zinc-500 pb-0.5">整库占比</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
