import { containsCjkText, matchesTextQuery, uniqueStrings } from '@/lib/anime-cast';
import type { AnimeListItem, AnimeSortBy, AnimeStatus } from '@/lib/anime-shared';

export type QuickRecordResponse = {
  ok: boolean;
  count?: number;
  createdCount?: number;
  updatedCount?: number;
  replayCount?: number;
  historySkippedCount?: number;
  created?: boolean;
  replay?: boolean;
  rewatchTag?: string;
  parsed?: {
    animeTitle?: string;
    originalTitle?: string;
  };
  recognition?: {
    matchedTitle?: string;
    standardTitle?: string;
    originalTitle?: string;
    enriched?: boolean;
    historyWritten?: boolean;
  };
  entry?: {
    title?: string;
    progress?: number;
  };
  results?: Array<{
    entry?: { title?: string };
    recognition?: { matchedTitle?: string; standardTitle?: string };
  }>;
  errors?: Array<{ title: string; error: string }>;
};

export function compareNumberValues(left: number, right: number, order: 'asc' | 'desc') {
  return order === 'asc' ? left - right : right - left;
}

export function compareTextValues(left: string, right: string, order: 'asc' | 'desc') {
  const result = left.localeCompare(right, 'zh-CN');
  return order === 'asc' ? result : -result;
}

export function compareDateValues(left: string | undefined, right: string | undefined, order: 'asc' | 'desc') {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;
  const leftMissing = Number.isNaN(leftTime);
  const rightMissing = Number.isNaN(rightTime);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  return order === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

export function formatRecentWatchDate(value: string | undefined) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function buildQuickRecordMessage(data: QuickRecordResponse) {
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length > 1) {
    const titlePreview = results
      .slice(0, 3)
      .map((item) => item?.entry?.title || item?.recognition?.matchedTitle || item?.recognition?.standardTitle || '番剧')
      .join('、');
    const tail = results.length > 3 ? ` 等${results.length}部` : '';
    const countsText = `新建${Number(data.createdCount) || 0}，更新${Number(data.updatedCount) || 0}，补记${Number(data.replayCount) || 0}`;
    const historyText = Number(data.historySkippedCount) > 0 ? `；${data.historySkippedCount}条历史记录未写入今日时间` : '';
    const errorText = Array.isArray(data.errors) && data.errors.length > 0 ? `；${data.errors.length}条处理失败` : '';
    return `已处理 ${results.length} 条：${titlePreview}${tail}；${countsText}${historyText}${errorText}`;
  }

  const title = data.entry?.title || data.recognition?.matchedTitle || '番剧';
  const progress = data.entry?.progress;
  const standardTitle = typeof data.recognition?.standardTitle === 'string' ? data.recognition.standardTitle : data.parsed?.animeTitle;
  const originalTitle = typeof data.recognition?.originalTitle === 'string' ? data.recognition.originalTitle : data.parsed?.originalTitle;
  const enriched = Boolean(data.recognition?.enriched);
  const historyWritten = data.recognition?.historyWritten !== false;
  const rewatchTag = typeof data.rewatchTag === 'string' ? data.rewatchTag : '';
  const stateText = data.created ? (rewatchTag ? `${rewatchTag}已新建并记录` : '已新建并记录') : (data.replay ? '已补记' : '已记录');
  const recognizedText = standardTitle ? `；识别：${standardTitle}${originalTitle ? ` / ${originalTitle}` : ''}` : '';
  const enrichedText = enriched ? '（已AI补全）' : '';
  const historyText = historyWritten ? '' : '；历史补录未写入今日观看时间';
  return `${stateText}：${title}${Number.isFinite(progress) ? `（EP ${progress}）` : ''}${recognizedText}${enrichedText}${historyText}`;
}

export function buildVoiceActorSuggestions(items: AnimeListItem[]) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const names = uniqueStrings([
      ...(item.castAliases || []).filter((name: string) => containsCjkText(name)),
      ...(item.cast || []),
    ]);

    for (const name of names) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map(([name]) => name);
}

export function buildTagPreferences(items: AnimeListItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.tags || [])))
    .map((tag) => ({
      tag,
      count: items.filter((item) => (item.tags || []).includes(tag)).length,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 18);
}

export function buildRecentWatchItems(items: AnimeListItem[]) {
  return [...items]
    .filter((item) => Boolean(item.lastWatchedAt))
    .sort((left, right) => compareDateValues(left.lastWatchedAt, right.lastWatchedAt, 'desc'))
    .slice(0, 5);
}

export function buildLibraryStats(items: AnimeListItem[]) {
  const unfinishedCount = items.filter((item) => item.status !== 'completed').length;
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const watchedEpisodes = items.reduce((total, item) => total + (Number(item.progress) || 0), 0);
  const totalMinutes = items.reduce((total, item) => {
    const progress = Number(item.progress) || 0;
    const duration = Number(item.durationMinutes) || 24;
    return total + progress * duration;
  }, 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = (totalHours / 24).toFixed(1);

  return {
    unfinishedCount,
    completedCount,
    watchedEpisodes,
    totalHoursText: `${totalHours}h / ${totalDays}d`,
  };
}

export function filterAndSortAnimeItems(
  items: AnimeListItem[],
  filters: {
    filterStatus: AnimeStatus | 'all';
    searchQuery: string;
    castQuery: string;
    tagFilter: string;
    sortBy: AnimeSortBy;
    sortOrder: 'asc' | 'desc';
  }
) {
  const { filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder } = filters;

  const result = items.filter((item) => {
    const matchesStatus = filterStatus === 'all' || item.status === filterStatus;
    const matchesSearch = matchesTextQuery(searchQuery, [item.title, item.originalTitle], item.cast, item.castAliases);
    const matchesCast = matchesTextQuery(castQuery, item.cast, item.castAliases);
    const matchesTag = matchesTextQuery(tagFilter, item.tags);
    return matchesStatus && matchesSearch && matchesCast && matchesTag;
  });

  return result.sort((left, right) => {
    if (sortBy === 'score') {
      return compareNumberValues(left.score ?? 0, right.score ?? 0, sortOrder);
    }

    if (sortBy === 'progress') {
      return compareNumberValues(left.progress, right.progress, sortOrder);
    }

    if (sortBy === 'title') {
      return compareTextValues(left.title, right.title, sortOrder);
    }

    if (sortBy === 'lastWatchedAt') {
      const leftHasWatch = Boolean(left.lastWatchedAt);
      const rightHasWatch = Boolean(right.lastWatchedAt);

      if (leftHasWatch && rightHasWatch) {
        return compareDateValues(left.lastWatchedAt, right.lastWatchedAt, sortOrder);
      }

      if (leftHasWatch !== rightHasWatch) {
        return leftHasWatch ? -1 : 1;
      }

      return compareDateValues(left.createdAt, right.createdAt, sortOrder);
    }

    if (sortBy === 'updatedAt') {
      return compareDateValues(left.updatedAt, right.updatedAt, sortOrder);
    }

    if (sortBy === 'createdAt') {
      return compareDateValues(left.createdAt, right.createdAt, sortOrder);
    }

    if (sortBy === 'startDate') {
      return compareDateValues(left.startDate, right.startDate, sortOrder);
    }

    return compareDateValues(left.endDate, right.endDate, sortOrder);
  });
}