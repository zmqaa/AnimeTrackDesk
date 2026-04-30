
"use client";

import { memo, useEffect, useState } from 'react';
import { formatTime, formatDate } from '@/lib/formatters';

const TimeDisplay = memo(function TimeDisplay() {
    const [nowText, setNowText] = useState<{ time: string; date: string } | null>(null);

    useEffect(() => {
        const tick = () => {
            const now = new Date();
            setNowText({ time: formatTime(now), date: formatDate(now) });
        };
        tick();
        const interval = window.setInterval(tick, 1000);
        return () => window.clearInterval(interval);
    }, []);

    return (
        <p className="text-muted-foreground font-mono text-sm opacity-60 min-h-[1.25rem]">
            {nowText ? `${nowText.date} · ${nowText.time}` : ''}
        </p>
    );
});

interface DashboardHeaderProps {
    isLoading: boolean;
    isRefreshing: boolean;
}

export default function DashboardHeader({ isLoading, isRefreshing }: DashboardHeaderProps) {
    return (
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-6 mb-10 relative z-10">
            <div className="space-y-3 max-w-3xl">
                <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground/95 flex items-center gap-4">
                    动漫记录总览
                </h1>
                <p className="text-sm md:text-base text-zinc-400 leading-6 max-w-2xl">
                    观看记录、评分和元数据，一览无余。
                </p>
                <TimeDisplay />
            </div>
            <div className="flex items-center gap-3 self-stretch xl:self-auto">
                {(isLoading || isRefreshing) && (
                    <div className="flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[10px] font-mono text-blue-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                        {isLoading ? '初始化数据中...' : '数据同步中...'}
                    </div>
                )}
            </div>
        </div>
    );
}
