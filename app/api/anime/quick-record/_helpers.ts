/**
 * Quick record 辅助逻辑：重刷检测、日期/进度推导、patch 构建
 * 从 quick-record/route.ts 拆出的纯函数层
 */

import { parseChineseNumberToken } from '@/lib/chinese-parser';
import { uniqueStrings } from '@/lib/anime-cast';
import type { CreateAnimeDTO, AnimeRecord } from '@/lib/anime';
import type { ParsedQuickRecordIntent } from '@/lib/ai';

// ── 重刷 (rewatch) 工具 ──

export function parseRewatchCountToken(token: string): number | undefined {
  const normalized = token.trim();
  if (!normalized) return undefined;

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 2 ? parsed : undefined;
  }

  const result = parseChineseNumberToken(normalized);
  return result !== undefined && result >= 2 ? result : undefined;
}

export function detectRewatchTag(text: string): string | undefined {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return undefined;

  const countToken = compact.match(/([0-9]{1,3}|[一二两三四五六七八九十]+)\s*刷/i)?.[1];
  if (countToken) {
    const count = parseRewatchCountToken(countToken);
    if (count && count >= 2) return `${count}刷`;
  }

  if (/二周目|重刷|重温|再刷/i.test(compact)) return '二刷';
  return undefined;
}

function parseRewatchTagCount(tag: string): number | undefined {
  const match = tag.trim().match(/^([0-9]{1,3}|[一二两三四五六七八九十]+)刷$/i);
  if (!match) return undefined;
  return parseRewatchCountToken(match[1]);
}

function formatRewatchTag(count: number): string {
  const cjkMap: Record<number, string> = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
  return cjkMap[count] ? `${cjkMap[count]}刷` : `${count}刷`;
}

export function resolveNextRewatchTag(records: Pick<AnimeRecord, 'tags'>[]): string {
  let highestCount = 1;
  for (const record of records) {
    for (const tag of record.tags ?? []) {
      const parsed = parseRewatchTagCount(tag);
      if (parsed && parsed > highestCount) highestCount = parsed;
    }
  }
  const baselineCount = Math.max(records.length, 1);
  return formatRewatchTag(Math.max(2, highestCount + 1, baselineCount + 1));
}

export function isCompletedAnimeRecord(record: Pick<AnimeRecord, 'status' | 'progress' | 'totalEpisodes'>): boolean {
  const finishedByProgress = Boolean(record.totalEpisodes) && record.progress >= Number(record.totalEpisodes);
  return record.status === 'completed' || finishedByProgress;
}

export function shouldAutoResolveRewatch(
  parsed: Pick<ParsedQuickRecordIntent, 'status' | 'episode' | 'progress'>,
  anime: Pick<AnimeRecord, 'status' | 'progress' | 'totalEpisodes'>,
): boolean {
  if (!isCompletedAnimeRecord(anime)) {
    return false;
  }

  if (parsed.status === 'completed') {
    return true;
  }

  if (parsed.episode === 1 || parsed.progress === 1) {
    return true;
  }

  const hasExplicitProgress = parsed.episode !== undefined || parsed.progress !== undefined;
  return !hasExplicitProgress && (parsed.status === 'watching' || parsed.status === undefined);
}

// ── 日期 / 进度推导 ──

export function normalizeDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveRecordedDateString(parsed: ParsedQuickRecordIntent): string | undefined {
  return parsed.watchedAt || (!parsed.isHistorical ? toDateString(new Date()) : undefined);
}

export function resolveIntentStatus(parsed: ParsedQuickRecordIntent, progress: number) {
  if (parsed.status) return parsed.status;
  if (progress > 0) return 'watching' as const;
  return 'plan_to_watch' as const;
}

export function resolveTargetProgress(parsed: ParsedQuickRecordIntent, currentProgress: number, totalEpisodes?: number): number {
  if (parsed.status === 'completed' && totalEpisodes && totalEpisodes > 0) return totalEpisodes;
  if (parsed.progress !== undefined && parsed.progress > 0) return parsed.progress;
  if (parsed.episode !== undefined && parsed.episode > 0) return parsed.episode;
  if (parsed.status === 'plan_to_watch' || parsed.status === 'completed') return currentProgress;
  return currentProgress > 0 ? currentProgress + 1 : 1;
}

// ── 数组合并 ──

export function mergeStringArrays(...arrays: Array<string[] | undefined>): string[] | undefined {
  const merged = uniqueStrings(arrays.flatMap((items) => items || []));
  return merged.length > 0 ? merged : undefined;
}

export function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

export function hasPatchChanges(patch: Partial<CreateAnimeDTO>): boolean {
  return Object.keys(patch).length > 0;
}

// ── Recognition 结构 ──

export function buildRecognition(
  parsed: ParsedQuickRecordIntent,
  entry: Pick<AnimeRecord, 'title' | 'originalTitle'> | undefined,
  progress: number,
  enriched: boolean,
  historyWritten: boolean,
  watchedAt: string | undefined,
  status: string,
) {
  return {
    standardTitle: parsed.animeTitle,
    originalTitle: parsed.originalTitle || null,
    season: parsed.season || null,
    episode: parsed.episode ?? null,
    progress,
    status,
    watchedAt: watchedAt || null,
    matchedTitle: entry?.title || null,
    matchedOriginalTitle: entry?.originalTitle || null,
    isHistorical: Boolean(parsed.isHistorical),
    enriched,
    historyWritten,
  };
}
