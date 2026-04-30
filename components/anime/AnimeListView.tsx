"use client";

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CheckIcon, PlusIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import type { AnimeCardItem, AnimeStatus } from '@/lib/anime-shared';
import { statusLabels } from '@/lib/dashboard-types';

const statusDotColors: Record<AnimeStatus, string> = {
  watching: 'bg-blue-400',
  completed: 'bg-emerald-400',
  dropped: 'bg-zinc-500',
  plan_to_watch: 'bg-purple-400',
};

interface AnimeListViewProps {
  items: AnimeCardItem[];
  onEdit: (item: AnimeCardItem) => void;
  updateProgress: (id: number, current: number, total?: number | null) => Promise<void>;
  isAdmin?: boolean;
  detailReturnTo: string;
  onOpenDetail: () => void;
}

export default memo(function AnimeListView({ items, onEdit, updateProgress, isAdmin = false, detailReturnTo, onOpenDetail }: AnimeListViewProps) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const isCompleted = item.status === 'completed';
        const progressPercent = item.totalEpisodes ? (item.progress / item.totalEpisodes) * 100 : 0;
        const detailHref = `/anime/${item.id}?returnTo=${encodeURIComponent(detailReturnTo)}`;

        return (
          <div
            key={item.id}
            className="group surface-card-muted flex items-center gap-4 p-3 rounded-2xl hover:border-white/10 transition-all duration-200"
          >
            {/* 封面缩略图 */}
            <Link href={detailHref} onClick={onOpenDetail} className="flex-shrink-0 w-14 h-[74px] rounded-xl overflow-hidden bg-zinc-900 relative">
              {item.coverUrl ? (
                <Image
                  src={item.coverUrl}
                  alt={item.title}
                  fill
                  sizes="56px"
                  className="object-cover"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    target.parentElement!.classList.add('anime-cover-fallback');
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center anime-cover-fallback">
                  <span className="text-lg">🎬</span>
                </div>
              )}
            </Link>

            {/* 标题与标签 */}
            <div className="flex-1 min-w-0 py-0.5">
              <Link href={detailHref} onClick={onOpenDetail} className="block">
                <h3 className="text-sm font-medium text-zinc-100 truncate group-hover:text-emerald-300 transition-colors">
                  {item.title}
                </h3>
                {item.originalTitle && (
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">{item.originalTitle}</p>
                )}
              </Link>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[item.status]}`} />
                <span className="text-[10px] text-zinc-500">{statusLabels[item.status]}</span>
                {item.score != null && (
                  <span className="text-[10px] text-amber-400 font-mono">★ {item.score}</span>
                )}
                {item.durationMinutes && (
                  <span className="text-[10px] text-zinc-600">{item.durationMinutes}m</span>
                )}
              </div>
            </div>

            {/* 进度 */}
            <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0 min-w-[120px]">
              <span className="text-xs text-zinc-400 font-mono">
                {item.progress} / {item.totalEpisodes || '?'}
              </span>
              <div className="h-1.5 w-24 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${isCompleted ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                  style={{ width: `${Math.min(progressPercent || 0, 100)}%` }}
                />
              </div>
            </div>

            {/* 操作按钮 */}
            {isAdmin && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => updateProgress(item.id, item.progress - 1, item.totalEpisodes)}
                  disabled={item.progress <= 0}
                  className="surface-pill p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-[10px] disabled:opacity-30"
                  aria-label="减一集"
                >
                  -1
                </button>
                {isCompleted ? (
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500" aria-label="已完成">
                    <CheckIcon className="w-4 h-4" />
                  </div>
                ) : (
                  <button
                    onClick={() => updateProgress(item.id, item.progress + 1, item.totalEpisodes)}
                    className="p-1.5 rounded-lg bg-white text-black hover:opacity-90 transition"
                    aria-label="加一集"
                  >
                    <PlusIcon className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => onEdit(item)}
                  className="surface-pill p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition opacity-0 group-hover:opacity-100"
                  aria-label="编辑"
                >
                  <EllipsisHorizontalIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
