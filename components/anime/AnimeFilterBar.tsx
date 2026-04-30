"use client";

import { ArrowsUpDownIcon, ChevronDownIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import type { AnimeStatus, AnimeSortBy } from '@/lib/anime-shared';

interface AnimeFilterBarProps {
  filterStatus: AnimeStatus | 'all';
  setFilterStatus: (s: AnimeStatus | 'all') => void;
    castQuery: string;
    setCastQuery: (value: string) => void;
    voiceActorSuggestions: string[];
    sortBy: AnimeSortBy;
    setSortBy: (s: AnimeSortBy) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (o: 'asc' | 'desc') => void;
  itemsCount: number;
}

export default function AnimeFilterBar({
  filterStatus,
  setFilterStatus,
    castQuery,
    setCastQuery,
    voiceActorSuggestions,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  itemsCount
}: AnimeFilterBarProps) {
  const [isSortOpen, setIsSortOpen] = useState(false);
    const statusLabels: Record<AnimeStatus | 'all', string> = {
        all: '全部',
        watching: '追番',
        completed: '看完',
        plan_to_watch: '想看',
        dropped: '弃坑',
    };

    const sortLabels: Record<AnimeSortBy, string> = {
        lastWatchedAt: '最近观看',
        updatedAt: '最近编辑',
        createdAt: '最近添加',
        startDate: '开始观看',
        endDate: '看完日期',
        score: '评分',
        progress: '进度',
        title: '名称',
    };

      const sortOptions: Array<{ val: AnimeSortBy; label: string }> = [
        { val: 'lastWatchedAt', label: '最近观看' },
        { val: 'updatedAt', label: '最近编辑' },
        { val: 'createdAt', label: '最近添加' },
        { val: 'startDate', label: '开始观看' },
        { val: 'endDate', label: '看完日期' },
        { val: 'score', label: '评分' },
        { val: 'progress', label: '进度' },
        { val: 'title', label: '名称' },
      ];

  return (
    <>
            <div className="flex flex-col gap-4 mb-2 animate-in fade-in slide-in-from-top-2">
                <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between">
                    <div className="surface-card-muted flex p-1 rounded-xl shadow-inner overflow-x-auto max-w-full no-scrollbar">
             {(['all', 'watching', 'completed', 'plan_to_watch', 'dropped'] as const).map((s) => {
                 const isActive = filterStatus === s;
                 const activeStyles = "bg-zinc-800 text-white shadow-md";
                 const inactiveStyles = "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50";
                 
                 return (
                     <button
                         key={s}
                         onClick={() => setFilterStatus(s)}
                         className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${isActive ? activeStyles : inactiveStyles}`}
                     >
                         {statusLabels[s]}
                     </button>
                 );
             })}
                    </div>

                    <div className="flex items-center gap-3 w-full xl:w-auto">
                        <div className="relative flex-1 xl:flex-none xl:w-[220px]">
                            <FunnelIcon className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="text"
                                value={castQuery}
                                onChange={(event) => setCastQuery(event.target.value)}
                                placeholder="按声优筛选，支持中文别名"
                                list="anime-cast-suggestions"
                                className="surface-input w-full rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40"
                            />
                            <datalist id="anime-cast-suggestions">
                                {voiceActorSuggestions.map((name) => (
                                    <option key={name} value={name} />
                                ))}
                            </datalist>
                        </div>

                        <div className="relative">
              <button
                  onClick={() => setIsSortOpen(!isSortOpen)}
                  onBlur={() => setTimeout(() => setIsSortOpen(false), 200)}
                    className="surface-pill flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:border-white/10 transition-all cursor-pointer shadow-sm w-[140px] justify-between"
              >
                  <div className="flex items-center gap-2">
                      <ArrowsUpDownIcon className="w-4 h-4" />
                      <span>{sortLabels[sortBy]}</span>
                  </div>
                  <ChevronDownIcon className={`w-3 h-3 transition-transform duration-300 ${isSortOpen ? 'rotate-180' : ''}`} />
              </button>

              <div className={`surface-card absolute right-0 top-full mt-2 w-40 rounded-xl shadow-xl overflow-hidden z-50 transition-all duration-200 origin-top-right ${isSortOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2 pointer-events-none'}`}>
                 <div className="p-1">
                     {sortOptions.map((opt) => (
                         <button
                             key={opt.val}
                             onClick={() => { setSortBy(opt.val); setIsSortOpen(false); }}
                             className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${sortBy === opt.val ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
                         >
                             {opt.label}
                             {sortBy === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>}
                         </button>
                     ))}
                 </div>
              </div>
          </div>

            <button 
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="surface-pill w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:border-white/10 transition-all shadow-sm group"
              title={sortOrder === 'asc' ? '升序 (A-Z)' : '降序 (Z-A)'}
            >
              <div className={`transition-transform duration-300 ${sortOrder === 'desc' ? 'rotate-180' : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <polyline points="19 12 12 19 5 12"></polyline>
                  </svg>
              </div>
            </button>
          </div>
        </div>
      </div>
      <div className="flex justify-end text-[10px] text-zinc-600 font-mono mb-4 px-1">
          SHOWING {itemsCount} TITLES
      </div>
    </>
  );
}
