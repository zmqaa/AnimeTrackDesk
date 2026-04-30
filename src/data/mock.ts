import type { AppPreferences, AnimeEntry, WatchHistoryEntry } from "../types";

export const seedAnimeEntries: AnimeEntry[] = [
  {
    id: "frieren",
    title: "葬送的芙莉莲",
    season: "2023 秋",
    episodes: 28,
    progress: 24,
    status: "watching",
    score: 9.6,
    tags: ["冒险", "公路", "成长"],
    summary: "节奏平静但情绪层层推进，很适合桌面端做沉浸式记录。",
    updatedAt: "2026-04-27T21:30:00.000Z",
  },
  {
    id: "apothecary-diaries-s2",
    title: "药屋少女的呢喃 第二季",
    season: "2026 春",
    episodes: 24,
    progress: 8,
    status: "watching",
    score: 8.9,
    tags: ["悬疑", "宫廷", "日常"],
    summary: "需要保留时间线和补番备注，未来适合接 SQLite 的历史表。",
    updatedAt: "2026-04-26T15:00:00.000Z",
  },
  {
    id: "witch-hat-atelier",
    title: "魔法帽的工作室",
    season: "2026 待播",
    episodes: 12,
    progress: 0,
    status: "planned",
    score: 0,
    tags: ["奇幻", "作画", "期待"],
    summary: "先放进想看列表，等待正式播出后转为在看。",
    updatedAt: "2026-04-22T10:20:00.000Z",
  },
  {
    id: "pluto",
    title: "PLUTO 冥王",
    season: "2023 秋",
    episodes: 8,
    progress: 8,
    status: "completed",
    score: 9.1,
    tags: ["科幻", "悬疑", "致敬"],
    summary: "补完后适合挂在概览区做近期完成展示。",
    updatedAt: "2026-04-14T09:00:00.000Z",
  },
];

export const seedHistory: WatchHistoryEntry[] = [
  {
    id: "h1",
    animeId: "frieren",
    animeTitle: "葬送的芙莉莲",
    episode: 24,
    watchedAt: "2026-04-27T21:30:00.000Z",
    note: "补到黄金乡篇，情绪拉满。",
  },
  {
    id: "h2",
    animeId: "apothecary-diaries-s2",
    animeTitle: "药屋少女的呢喃 第二季",
    episode: 8,
    watchedAt: "2026-04-26T15:00:00.000Z",
    note: "准备后续把 AI 摘要接到条目整理里。",
  },
  {
    id: "h3",
    animeId: "pluto",
    animeTitle: "PLUTO 冥王",
    episode: 8,
    watchedAt: "2026-04-14T09:00:00.000Z",
    note: "已补完，待补一段个人短评。",
  },
];

export const defaultPreferences: AppPreferences = {
  nickname: "动漫记录",
  themeName: "Sunset Archive",
  ai: {
    enabled: false,
    provider: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
  },
};