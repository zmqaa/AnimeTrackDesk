
"use client";

import { memo } from 'react';
import { WatchHistoryRecord } from '@/lib/dashboard-types';

export default memo(function ActivityFeed({ history }: { history: WatchHistoryRecord[] }) {
    if (history.length === 0) return <div className="text-zinc-500 text-sm text-center py-10">暂无活动记录</div>;

    const grouped: Record<string, WatchHistoryRecord[]> = {};
    history.slice(0, 15).forEach(item => {
        const dateStr = new Date(item.watchedAt).toLocaleDateString('zh-CN');
        if (!grouped[dateStr]) grouped[dateStr] = [];
        grouped[dateStr].push(item);
    });

    return (
        <div className="space-y-8 relative border-l border-white/8 ml-3 pl-7 py-3">
            {Object.entries(grouped).map(([date, items]) => (
                <div key={date} className="relative">
                    <span className="absolute -left-[34px] top-1.5 w-4 h-4 bg-zinc-950 border border-emerald-300/30 rounded-full z-10 shadow-[0_0_12px_rgba(86,211,156,0.22)]">
                        <span className="absolute inset-1 rounded-full bg-emerald-300/70" />
                    </span>
                    <h4 className="text-[10px] font-mono text-zinc-500 mb-4 tracking-[0.28em] uppercase">{date}</h4>
                    <div className="space-y-3">
                        {items.map(item => (
                            <div key={item.id} className="group surface-card-muted rounded-[22px] px-4 py-3 hover:border-emerald-300/20 hover:bg-white/[0.04] transition-all duration-300">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-600">Watch Log</div>
                                        <span className="mt-1 block text-sm text-zinc-300 group-hover:text-white transition-colors truncate">
                                            观看 <span className="font-semibold text-primary/90">{item.animeTitle}</span>
                                        </span>
                                    </div>
                                    <span className="surface-pill shrink-0 text-[10px] font-mono text-zinc-500 px-2 py-1 rounded-full">
                                        EP {item.episode}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
});
