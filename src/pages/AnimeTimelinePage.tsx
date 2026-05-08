import { CalendarIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { WatchHistoryRecord } from "@/lib/dashboard-types";
import { formatLocalTimeString } from "@/lib/local-date-time";
import { loadWatchHistoryRecords } from "@/src/lib/anime-store";

export default function AnimeTimelinePage() {
  const [history, setHistory] = useState<WatchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const detailReturnTo = "/anime/timeline";

  useEffect(() => {
    try {
      setHistory(loadWatchHistoryRecords());
    } finally {
      setLoading(false);
    }
  }, []);

  const groupedByMonth = useMemo(() => {
    const groups: Record<string, WatchHistoryRecord[]> = {};

    history.forEach((item) => {
      const date = new Date(item.watchedAt);
      const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(item);
    });

    return Object.entries(groups);
  }, [history]);

  if (loading) {
    return <div className="p-8 text-zinc-500 font-mono">LOADING_TIMELINE...</div>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-12 px-6 py-8 xl:px-10">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <Link to="/anime" className="mb-4 flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-white">
            <ChevronLeftIcon className="h-4 w-4" />
            返回番剧管理
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">追番见证录</h1>
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-mono">Anime Watch Journey Timeline</p>
        </div>
        <div className="hidden text-right sm:block">
          <span className="select-none text-4xl font-black italic text-white/5">TIMELINE</span>
        </div>
      </header>

      <div className="relative ml-4 max-w-5xl space-y-16 border-l-2 border-zinc-800 py-4 pl-8 xl:ml-6 xl:pl-10">
        {groupedByMonth.map(([month, items]) => (
          <div key={month} className="relative">
            <div className="absolute -left-[45px] top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900">
              <CalendarIcon className="h-4 w-4 text-primary" />
            </div>

            <div className="mb-8 flex items-center gap-3">
              <h2 className="surface-pill rounded-xl px-3 py-1.5 text-xl font-bold text-white">{month}</h2>
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-zinc-500">{items.length} 条记录</span>
            </div>

            <div className="space-y-8">
              {items.map((item) => (
                <div key={item.id} className="group relative">
                  <div className="absolute -left-[38px] top-2 h-3 w-3 rounded-full border-2 border-zinc-950 bg-zinc-800 shadow-[0_0_8px_rgba(0,0,0,1)] transition-colors group-hover:bg-primary"></div>

                  <div className="grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
                    <span className="shrink-0 text-xs font-mono text-zinc-500">
                      {formatLocalTimeString(item.watchedAt)}
                    </span>
                    <div className="surface-card-muted rounded-xl p-4 transition-all hover:border-primary/30">
                      <div className="flex items-center justify-between gap-3">
                        <Link to={`/anime/${item.animeId}?returnTo=${encodeURIComponent(detailReturnTo)}`} className="font-medium text-zinc-200 transition-colors hover:text-primary">
                          {item.animeTitle}
                        </Link>
                        <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-mono text-zinc-500">EPISODE {item.episode}</span>
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
        <div className="rounded-3xl border border-dashed border-zinc-800 py-20 text-center text-zinc-600">
          <span className="mb-4 block text-4xl">🎬</span>
          <p>暂无观看记录，去更新一下进度吧！</p>
        </div>
      )}

      <footer className="pb-8 pt-12 text-center">
        <p className="text-[10px] font-mono italic tracking-tighter text-zinc-700">&ldquo;Every episode is a page in your story.&rdquo;</p>
      </footer>
    </main>
  );
}