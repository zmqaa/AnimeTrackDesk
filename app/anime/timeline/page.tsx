"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeftIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { fetchJson } from '@/lib/client-api';

interface WatchHistoryRecord {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: string;
}

export default function AnimeTimelinePage() {
  const [history, setHistory] = useState<WatchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ entries?: WatchHistoryRecord[] }>('/api/history?limit=1000', undefined, '加载时间线失败')
      .then(data => {
        setHistory(Array.isArray(data?.entries) ? data.entries : []);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => setLoading(false));
  }, []);

  // Group by month
  const groupedByMonth: Record<string, WatchHistoryRecord[]> = {};
  history.forEach(item => {
    const date = new Date(item.watchedAt);
    const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
    if (!groupedByMonth[key]) groupedByMonth[key] = [];
    groupedByMonth[key].push(item);
  });

  if (loading) return <div className="p-8 text-zinc-500 font-mono">LOADING_TIMELINE...</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-12 px-6 py-8 xl:px-10">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
            <Link href="/anime" className="text-zinc-500 hover:text-white flex items-center gap-1 text-sm mb-4 transition-colors">
                <ChevronLeftIcon className="w-4 h-4" /> 返回番剧管理
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">追番见证录</h1>
            <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Anime Watch Journey Timeline</p>
        </div>
        <div className="hidden sm:block text-right">
            <span className="text-4xl font-black text-white/5 italic select-none">TIMELINE</span>
        </div>
      </header>

      <div className="relative ml-4 max-w-5xl space-y-16 border-l-2 border-zinc-800 py-4 pl-8 xl:ml-6 xl:pl-10">
        {Object.entries(groupedByMonth).map(([month, items]) => (
          <div key={month} className="relative">
            {/* Month Badge */}
            <div className="absolute -left-[45px] top-0 flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900 border-2 border-zinc-800 z-10">
                <CalendarIcon className="w-4 h-4 text-primary" />
            </div>
            
            <div className="mb-8 flex items-center gap-3">
              <h2 className="surface-pill rounded-xl px-3 py-1.5 text-xl font-bold text-white">
                  {month}
              </h2>
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-zinc-500">
                {items.length} 条记录
              </span>
            </div>

            <div className="space-y-8">
              {items.map((item) => (
                <div key={item.id} className="group relative">
                  {/* Dot */}
                  <div className="absolute -left-[38px] top-2 w-3 h-3 rounded-full bg-zinc-800 group-hover:bg-primary transition-colors border-2 border-zinc-950 shadow-[0_0_8px_rgba(0,0,0,1)]"></div>
                  
                  <div className="grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
                    <span className="shrink-0 text-xs font-mono text-zinc-500">
                        {new Date(item.watchedAt).toLocaleDateString('zh-CN', { day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="surface-card-muted p-4 rounded-xl hover:border-primary/30 transition-all">
                        <div className="flex justify-between items-center">
                            <Link href={`/anime/${item.animeId}`} className="text-zinc-200 font-medium hover:text-primary transition-colors">
                                {item.animeTitle}
                            </Link>
                            <span className="text-[10px] font-mono bg-white/5 px-2 py-1 rounded text-zinc-500">
                                EPISODE {item.episode}
                            </span>
                        </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {history.length === 0 && (
          <div className="text-center py-20 text-zinc-600 border border-dashed border-zinc-800 rounded-3xl">
              <span className="text-4xl mb-4 block">🎬</span>
              <p>暂无观看记录，去更新一下进度吧！</p>
          </div>
      )}
      
      <footer className="text-center pt-12 pb-8">
          <p className="text-[10px] text-zinc-700 font-mono tracking-tighter italic">
                &ldquo;Every episode is a page in your story.&rdquo;
          </p>
      </footer>
    </main>
  );
}
