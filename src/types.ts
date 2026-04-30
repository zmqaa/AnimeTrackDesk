export type AnimeStatus = "watching" | "planned" | "completed" | "paused";

export interface AnimeEntry {
  id: string;
  title: string;
  season: string;
  episodes: number;
  progress: number;
  status: AnimeStatus;
  score: number;
  tags: string[];
  summary: string;
  updatedAt: string;
}

export interface WatchHistoryEntry {
  id: string;
  animeId: string;
  animeTitle: string;
  episode: number;
  watchedAt: string;
  note: string;
}

export interface AiSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AppPreferences {
  nickname: string;
  themeName: string;
  ai: AiSettings;
}

export type AppSection = "overview" | "library" | "timeline" | "settings";