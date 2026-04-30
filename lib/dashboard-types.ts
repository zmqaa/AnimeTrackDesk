
import type { AnimeStatus } from './anime-shared';
export type { AnimeStatus };

export interface AnimeRecord {
  id: number;
  title: string;
  originalTitle?: string;
  coverUrl?: string;
  score?: number;
  progress: number;
  totalEpisodes?: number;
  durationMinutes?: number;
  status: AnimeStatus;
  tags?: string[];
  cast?: string[];
  castAliases?: string[];
  summary?: string;
  startDate?: string;
  endDate?: string;
  premiereDate?: string;
  isFinished?: boolean;
  createdAt: string;
  updatedAt: string;
  lastWatchedAt?: string;
}

export interface WatchHistoryRecord {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: string;
}

export interface ParsedWatchHistory extends WatchHistoryRecord {
  dateObj: Date;
  dateStr: string;
  hour: number;
  month: number;
  year: number;
}

export const statusLabels: Record<AnimeStatus, string> = {
  watching: '追番中',
  completed: '已看完',
  dropped: '已弃坑',
  plan_to_watch: '计划看',
};

export const statusColors: Record<AnimeStatus, string> = {
  watching: '#22c55e',
  completed: '#10b981',
  dropped: '#ef4444',
  plan_to_watch: '#8b5cf6',
};
