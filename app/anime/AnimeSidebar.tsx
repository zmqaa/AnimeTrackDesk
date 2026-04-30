"use client";

import Image from 'next/image';
import { FireIcon, SparklesIcon, TagIcon, TvIcon } from '@heroicons/react/24/outline';
import type { AnimeCardItem, AnimeListItem } from '@/lib/anime-shared';
import { buildLibraryStats, formatRecentWatchDate } from './anime-page-helpers';

type AnimeSidebarProps = {
  items: AnimeListItem[];
  tagPreferences: Array<{ tag: string; count: number }>;
  tagFilter: string;
  recentWatchItems: AnimeListItem[];
  isAdmin: boolean;
  onToggleTagFilter: (tag: string) => void;
  onEdit: (item: AnimeCardItem) => void;
};

export default function AnimeSidebar({
  items,
  tagPreferences,
  tagFilter,
  recentWatchItems,
  isAdmin,
  onToggleTagFilter,
  onEdit,
}: AnimeSidebarProps) {
  const libraryStats = buildLibraryStats(items);

  return (
    <div className="lg:col-span-4 space-y-6 sticky top-8">
      <div className="surface-card rounded-2xl p-8 shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <TvIcon className="w-20 h-20 text-white" />
        </div>
        <h3 className="text-base font-bold text-zinc-300 mb-8 uppercase tracking-widest flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span>
          库统计
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/10 transition-all group/stat">
            <p className="text-xs text-blue-400 font-bold uppercase mb-3 tracking-wider group-hover/stat:translate-x-1 transition-transform">还没看完</p>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold text-white tracking-tighter leading-none">{libraryStats.unfinishedCount}</p>
              <p className="text-xs text-zinc-500 font-bold">部</p>
            </div>
          </div>
          <div className="theme-accent-soft p-5 rounded-2xl transition-all group/stat">
            <p className="theme-accent-text text-xs font-bold uppercase mb-3 tracking-wider group-hover/stat:translate-x-1 transition-transform">已经看完</p>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold text-white tracking-tighter leading-none">{libraryStats.completedCount}</p>
              <p className="text-xs text-zinc-500 font-bold">部</p>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
          <div className="flex justify-between items-center group/info">
            <span className="text-sm font-medium text-zinc-500 group-hover/info:text-zinc-300 transition-colors">累计观看剧集</span>
            <span className="text-lg font-mono font-bold text-zinc-200 tracking-tight">
              {libraryStats.watchedEpisodes} <span className="text-[10px] text-zinc-600 ml-1 uppercase">Episodes</span>
            </span>
          </div>
          <div className="flex justify-between items-center group/info">
            <span className="text-sm font-medium text-zinc-500 group-hover/info:text-zinc-300 transition-colors">累计时间估计</span>
            <span className="text-lg font-mono font-bold text-blue-400 tracking-tight">{libraryStats.totalHoursText}</span>
          </div>
        </div>
      </div>

      <div className="surface-card rounded-2xl p-8 shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <TagIcon className="w-20 h-20 text-white" />
        </div>
        <h3 className="text-base font-bold text-zinc-300 mb-8 uppercase tracking-widest flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"></span>
          风格偏好
        </h3>
        <div className="flex flex-wrap gap-2.5 relative z-10">
          {tagPreferences.map(({ tag, count }) => {
            const isActive = tagFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTagFilter(tag)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all group/tag ${
                  isActive
                    ? 'bg-purple-500/15 border-purple-500/40'
                    : 'surface-pill hover:border-purple-500/30 hover:bg-purple-500/5'
                }`}
              >
                <span className={`text-xs font-medium transition-colors ${isActive ? 'text-purple-200' : 'text-zinc-400 group-hover/tag:text-purple-300'}`}>{tag}</span>
                <span className={`text-[10px] font-mono ${isActive ? 'text-purple-300/80' : 'text-zinc-600 group-hover/tag:text-purple-500/50'}`}>{count}</span>
              </button>
            );
          })}
          {!tagPreferences.length && <div className="text-xs text-zinc-500">标签还在累计中。</div>}
        </div>
      </div>

      <div className="surface-card rounded-2xl p-6 shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <FireIcon className="w-16 h-16 text-white" />
        </div>
        <h3 className="text-sm font-bold text-zinc-400 mb-6 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
          最近观看
        </h3>
        <div className="space-y-3 relative z-10">
          {recentWatchItems.length > 0 ? recentWatchItems.map((item) => (
            <div
              key={item.id}
              onClick={() => isAdmin && onEdit(item)}
              className={`flex items-center gap-3 p-2.5 -mx-2 rounded-xl transition-all ${isAdmin ? 'cursor-pointer hover:bg-white/5 hover:translate-x-1' : ''} group/item`}
            >
              <div className="surface-card-muted w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 group-hover/item:border-blue-500/30 transition-colors shadow-lg relative">
                {item.coverUrl ? (
                  <Image src={item.coverUrl} fill sizes="40px" className="object-cover transition-transform group-hover/item:scale-110" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600 uppercase">IMG</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-zinc-200 truncate group-hover/item:text-blue-400 transition-colors uppercase tracking-tight">{item.title}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-2">
                  <span className="font-medium">看到第 {item.progress} 集</span>
                  <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                  <span className="italic font-mono">{formatRecentWatchDate(item.lastWatchedAt)}</span>
                </div>
              </div>
              {isAdmin && (
                <div className="opacity-0 group-hover/item:opacity-100 transition-opacity">
                  <div className="p-1 rounded-md bg-blue-500/10 text-blue-400">
                    <SparklesIcon className="w-3 h-3" />
                  </div>
                </div>
              )}
            </div>
          )) : (
            <div className="text-sm text-zinc-500">暂无观看记录，先用“看一集”或 AI 录入补几条历史。</div>
          )}
        </div>
      </div>
    </div>
  );
}