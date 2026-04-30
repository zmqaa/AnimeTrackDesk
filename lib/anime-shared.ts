export type AnimeStatus = 'watching' | 'completed' | 'dropped' | 'plan_to_watch';

export type AnimeSortBy = 'lastWatchedAt' | 'updatedAt' | 'createdAt' | 'score' | 'progress' | 'title' | 'startDate' | 'endDate';

export interface SessionUser {
  role?: string;
}

export interface AnimeCardItem {
  id: number;
  title: string;
  originalTitle?: string;
  coverUrl?: string;
  status: AnimeStatus;
  score?: number;
  progress: number;
  totalEpisodes?: number | null;
  durationMinutes?: number;
  notes?: string;
  tags?: string[];
  startDate?: string;
  endDate?: string;
  isFinished?: boolean;
  lastWatchedAt?: string;
}

export interface AnimeListItem extends AnimeCardItem {
  cast?: string[];
  castAliases?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AnimeDetailItem extends AnimeListItem {
  summary?: string;
  premiereDate?: string;
}

export interface AnimeFormInitialData {
  title?: string;
  originalTitle?: string;
  progress?: string | number;
  totalEpisodes?: string | number;
  status?: AnimeStatus;
  notes?: string;
  coverUrl?: string;
  tags?: string;
  durationMinutes?: string | number;
  startDate?: string;
  endDate?: string;
  isFinished?: boolean;
}
