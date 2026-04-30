import 'server-only';
import { query } from './db';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2';
import { parseJsonStringArray } from './anime-cast';
import { extractSeasonNumber, hasSeasonMarker, normalizeTitleToken } from './chinese-parser';

/** 将 Date 对象按 CST (UTC+8) 截取为 YYYY-MM-DD 字符串，避免 UTC 截断导致差一天 */
function toDateStringCST(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(d);
}

// Anime Status: watching, completed, dropped, plan_to_watch
export type AnimeStatus = 'watching' | 'completed' | 'dropped' | 'plan_to_watch';

export interface AnimeRecord {
  id: number;
  title: string;
  originalTitle?: string; // Japanese or original name
  coverUrl?: string; // Optional cover image
  status: AnimeStatus;
  score?: number; // 0-10
  progress: number; // Current episode
  totalEpisodes?: number; // Total episodes if known
  durationMinutes?: number; // Average duration per episode in minutes
  notes?: string;
  tags?: string[]; // New: Tags
  cast?: string[];
  castAliases?: string[];
  summary?: string;
  startDate?: string; // Date string YYYY-MM-DD
  endDate?: string; // Date string YYYY-MM-DD
  premiereDate?: string; // Date string YYYY-MM-DD
  isFinished?: boolean; // New: Whether the anime itself is finished airing
  createdAt: string;
  updatedAt: string;
  lastWatchedAt?: string;
}

export interface CreateAnimeDTO {
  title: string;
  originalTitle?: string;
  coverUrl?: string;
  status: AnimeStatus;
  score?: number;
  progress: number;
  totalEpisodes?: number;
  durationMinutes?: number;
  notes?: string;
  tags?: string[];
  cast?: string[];
  castAliases?: string[];
  summary?: string;
  startDate?: string;
  endDate?: string;
  premiereDate?: string;
  isFinished?: boolean;
}

interface AnimeRow extends RowDataPacket {
  id: number;
  title: string;
  original_title?: string | null;
  coverUrl?: string | null;
  status: AnimeStatus;
  score?: number | string | null;
  progress: number;
  totalEpisodes?: number | null;
  durationMinutes?: number | null;
  notes?: string | null;
  tags?: string | null;
  summary?: string | null;
  start_date?: Date | string | null;
  end_date?: Date | string | null;
  premiere_date?: Date | string | null;
  cast?: string | null;
  cast_aliases?: string | null;
  isFinished?: number | boolean | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastWatchedAt?: Date | string | null;
}

// Helper to convert DB Row to AnimeRecord
function mapRowToAnimeRecord(row: AnimeRow): AnimeRecord {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title || undefined,
    coverUrl: row.coverUrl || undefined,
    status: row.status as AnimeStatus,
    score: row.score ? Number(row.score) : undefined,
    progress: row.progress,
    cast: parseJsonStringArray(row.cast),
    castAliases: parseJsonStringArray(row.cast_aliases),
    totalEpisodes: row.totalEpisodes || undefined,
    durationMinutes: row.durationMinutes || undefined,
    notes: row.notes || undefined,
    tags: parseJsonStringArray(row.tags),
    summary: row.summary || undefined,
    startDate: row.start_date instanceof Date ? toDateStringCST(row.start_date) : (row.start_date || undefined),
    endDate: row.end_date instanceof Date ? toDateStringCST(row.end_date) : (row.end_date || undefined),
    premiereDate: row.premiere_date instanceof Date ? toDateStringCST(row.premiere_date) : (row.premiere_date || undefined),
    isFinished: row.isFinished != null ? Boolean(row.isFinished) : undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    lastWatchedAt: row.lastWatchedAt
      ? (row.lastWatchedAt instanceof Date ? row.lastWatchedAt.toISOString() : String(row.lastWatchedAt))
      : undefined,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

function normalizeComparableText(value: string | undefined): string {
  return normalizeTitleToken(value).replace(/第[一二三四五六七八九十百零两〇0-9]+[季期]/gi, '').trim();
}

function getCandidateSeason(row: AnimeRow): number | undefined {
  return extractSeasonNumber(row.title) || extractSeasonNumber(row.original_title || undefined);
}

function classifyPrefixSuffix(queryTitle: string, candidateTitle: string): 'none' | 'exact' | 'first-season' | 'later-season' | 'subtitle' {
  const trimmedQuery = queryTitle.trim();
  const trimmedCandidate = candidateTitle.trim();
  if (!trimmedQuery || !trimmedCandidate.startsWith(trimmedQuery)) {
    return 'none';
  }

  const suffix = trimmedCandidate.slice(trimmedQuery.length).trim();
  if (!suffix) {
    return 'exact';
  }

  if (/^第\s*[一1]\s*[季期]$/i.test(suffix) || /^season\s*1$/i.test(suffix) || /^s\s*1$/i.test(suffix)) {
    return 'first-season';
  }

  if (/^第\s*[0-9一二三四五六七八九十百零两〇]+\s*[季期]$/i.test(suffix) || /^season\s*[0-9]{1,3}$/i.test(suffix) || /^s\s*[0-9]{1,3}$/i.test(suffix)) {
    return 'later-season';
  }

  return 'subtitle';
}

function toSortableTime(value: Date | string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function scoreAnimeTitleCandidate(row: AnimeRow, queryTitle: string) {
  const trimmedQuery = queryTitle.trim();
  const queryToken = normalizeTitleToken(trimmedQuery);
  const queryComparable = normalizeComparableText(trimmedQuery);
  const queryHasSeason = hasSeasonMarker(trimmedQuery);
  const requestedSeason = extractSeasonNumber(trimmedQuery);

  const title = row.title.trim();
  const originalTitle = (row.original_title || '').trim();
  const titleToken = normalizeTitleToken(title);
  const originalTitleToken = normalizeTitleToken(originalTitle);
  const titleComparable = normalizeComparableText(title);
  const originalComparable = normalizeComparableText(originalTitle);
  const candidateSeason = getCandidateSeason(row);
  const prefixKind = classifyPrefixSuffix(trimmedQuery, title);

  let score = 0;

  if (title === trimmedQuery) score += 10000;
  if (originalTitle && originalTitle === trimmedQuery) score += 9500;
  if (titleToken === queryToken) score += 9000;
  if (originalTitleToken && originalTitleToken === queryToken) score += 8500;
  if (titleComparable && titleComparable === queryComparable) score += 8000;
  if (originalComparable && originalComparable === queryComparable) score += 7600;

  if (title.startsWith(trimmedQuery)) score += 1400;
  if (titleToken.startsWith(queryToken)) score += 1100;
  if (originalTitleToken && originalTitleToken.startsWith(queryToken)) score += 900;
  if (title.includes(trimmedQuery)) score += 500;
  if (titleToken.includes(queryToken)) score += 350;
  if (originalTitleToken && originalTitleToken.includes(queryToken)) score += 250;

  if (prefixKind === 'exact') score += 600;
  if (prefixKind === 'first-season') score += 520;

  if (queryHasSeason && requestedSeason) {
    if (candidateSeason === requestedSeason) {
      score += 3200;
    } else if (candidateSeason !== undefined) {
      score -= Math.abs(candidateSeason - requestedSeason) * 700;
    }
  } else {
    if (candidateSeason === 1) {
      score += 450;
    } else if (candidateSeason && candidateSeason > 1) {
      score -= candidateSeason * 180;
    }

    if (prefixKind === 'later-season') score -= 300;
    if (prefixKind === 'subtitle') score -= 120;
  }

  return {
    row,
    score,
    premiereTime: toSortableTime(row.premiere_date, Number.MAX_SAFE_INTEGER),
    createdTime: toSortableTime(row.createdAt, Number.MAX_SAFE_INTEGER),
    updatedTime: toSortableTime(row.updatedAt, 0),
  };
}

function pickBestAnimeTitleCandidate(rows: AnimeRow[], queryTitle: string): AnimeRow | null {
  if (rows.length === 0) {
    return null;
  }

  const queryHasSeason = hasSeasonMarker(queryTitle);
  const ranked = rows
    .map((row) => scoreAnimeTitleCandidate(row, queryTitle))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (!queryHasSeason && left.premiereTime !== right.premiereTime) {
        return left.premiereTime - right.premiereTime;
      }

      if (right.updatedTime !== left.updatedTime) {
        return right.updatedTime - left.updatedTime;
      }

      return left.createdTime - right.createdTime;
    });

  return ranked[0]?.row || null;
}

export interface ListAnimeOptions {
  status?: AnimeStatus;
  limit?: number;
  offset?: number;
}

export async function listAnimeRecords(options: ListAnimeOptions = {}): Promise<AnimeRecord[]> {
  const { status, limit, offset } = options;
  let sql = 'SELECT * FROM anime';
  const params: unknown[] = [];
  
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY updatedAt DESC';

  if (limit && limit > 0) {
    sql += ' LIMIT ?';
    params.push(Math.floor(Number(limit)));
    if (offset && offset > 0) {
      sql += ' OFFSET ?';
      params.push(Math.floor(Number(offset)));
    }
  }

  const rows = await query<AnimeRow[]>(sql, params);
  return rows.map(mapRowToAnimeRecord);
}

export async function listAnimeRecordsWithLastWatched(options: ListAnimeOptions = {}): Promise<AnimeRecord[]> {
  const { status, limit, offset } = options;
  let sql = `
    SELECT anime.*, latest_watch.lastWatchedAt
    FROM anime
    LEFT JOIN (
      SELECT animeId, MAX(watchedAt) AS lastWatchedAt
      FROM watch_history
      GROUP BY animeId
    ) AS latest_watch ON latest_watch.animeId = anime.id
  `;
  const params: unknown[] = [];

  if (status) {
    sql += ' WHERE anime.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY anime.updatedAt DESC';

  if (limit && limit > 0) {
    sql += ' LIMIT ?';
    params.push(Math.floor(Number(limit)));
    if (offset && offset > 0) {
      sql += ' OFFSET ?';
      params.push(Math.floor(Number(offset)));
    }
  }

  const rows = await query<AnimeRow[]>(sql, params);
  return rows.map(mapRowToAnimeRecord);
}

export async function countAnimeRecords(status?: AnimeStatus): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM anime';
  const params: unknown[] = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  const rows = await query<(RowDataPacket & { count: number })[]>(sql, params);
  return Number(rows[0]?.count || 0);
}

export async function getAnimeRecord(id: number): Promise<AnimeRecord | null> {
  const rows = await query<AnimeRow[]>('SELECT * FROM anime WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  return mapRowToAnimeRecord(rows[0]);
}

export async function createAnimeRecord(input: CreateAnimeDTO): Promise<AnimeRecord> {
  const sql = `
    INSERT INTO anime (title, original_title, coverUrl, status, score, progress, totalEpisodes, durationMinutes, notes, tags, summary, start_date, end_date, premiere_date, cast, cast_aliases, isFinished) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const params = [
    input.title,
    input.originalTitle || null,
    input.coverUrl || null,
    input.status,
    input.score || null,
    input.progress,
    input.totalEpisodes || null,
    input.durationMinutes || null,
    input.notes || null,
    JSON.stringify(input.tags || []),
    input.summary || null,
    input.startDate || null,
    input.endDate || null,
    input.premiereDate || null,
    JSON.stringify(input.cast || []),
    JSON.stringify(input.castAliases || []),
    input.isFinished != null ? (input.isFinished ? 1 : 0) : null
  ];

  const result = await query<ResultSetHeader>(sql, params);
  
  // 直接构造返回值，避免多余的 SELECT 查询
  const now = new Date().toISOString();
  return {
    id: result.insertId,
    title: input.title,
    originalTitle: input.originalTitle,
    coverUrl: input.coverUrl,
    status: input.status,
    score: input.score,
    progress: input.progress,
    totalEpisodes: input.totalEpisodes,
    durationMinutes: input.durationMinutes,
    notes: input.notes,
    tags: input.tags || [],
    cast: input.cast || [],
    castAliases: input.castAliases || [],
    summary: input.summary,
    startDate: input.startDate,
    endDate: input.endDate,
    premiereDate: input.premiereDate,
    isFinished: input.isFinished != null ? Boolean(input.isFinished) : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateAnimeRecord(
  id: number,
  input: Partial<CreateAnimeDTO>
): Promise<AnimeRecord | null> {
  // Dynamic update query
  const fields: string[] = [];
  const params: unknown[] = [];

  if (input.originalTitle !== undefined) { fields.push('original_title = ?'); params.push(input.originalTitle); }
  if (input.title !== undefined) { fields.push('title = ?'); params.push(input.title); }
  if (input.coverUrl !== undefined) { fields.push('coverUrl = ?'); params.push(input.coverUrl); }
  if (input.status !== undefined) { fields.push('status = ?'); params.push(input.status); }
  if (input.score !== undefined) { fields.push('score = ?'); params.push(input.score); }
  if (input.progress !== undefined) { fields.push('progress = ?'); params.push(input.progress); }
  if (input.totalEpisodes !== undefined) { fields.push('totalEpisodes = ?'); params.push(input.totalEpisodes); }
  if (input.durationMinutes !== undefined) { fields.push('durationMinutes = ?'); params.push(input.durationMinutes); }
  if (input.notes !== undefined) { fields.push('notes = ?'); params.push(input.notes); }
  if (input.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(input.tags)); }
  if (input.summary !== undefined) { fields.push('summary = ?'); params.push(input.summary); }
  if (input.startDate !== undefined) { fields.push('start_date = ?'); params.push(input.startDate); }
  if (input.endDate !== undefined) { fields.push('end_date = ?'); params.push(input.endDate); }
  if (input.premiereDate !== undefined) { fields.push('premiere_date = ?'); params.push(input.premiereDate); }
  if (input.cast !== undefined) { fields.push('cast = ?'); params.push(JSON.stringify(input.cast)); }
  if (input.castAliases !== undefined) { fields.push('cast_aliases = ?'); params.push(JSON.stringify(input.castAliases)); }
  if (input.isFinished !== undefined) { fields.push('isFinished = ?'); params.push(input.isFinished ? 1 : 0); }

  if (fields.length === 0) return await getAnimeRecord(id);

  const sql = `UPDATE anime SET ${fields.join(', ')} WHERE id = ?`;
  params.push(id);

  await query(sql, params);
  
  return await getAnimeRecord(id);
}

export async function deleteAnimeRecord(id: number): Promise<void> {
  await query('DELETE FROM anime WHERE id = ?', [id]);
}

export async function findAnimeByTitle(title: string): Promise<AnimeRecord | null> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return null;
  }

  // 单次查询：精确匹配 + 模糊匹配合并，避免多次 round-trip
  const escapedTitle = escapeLikePattern(normalizedTitle);
  const rows = await query<AnimeRow[]>(
    `
      SELECT *
      FROM anime
      WHERE title = ?
         OR original_title = ?
         OR title LIKE ? ESCAPE '!'
         OR title LIKE ? ESCAPE '!'
         OR original_title LIKE ? ESCAPE '!'
         OR original_title LIKE ? ESCAPE '!'
      LIMIT 50
    `,
    [normalizedTitle, normalizedTitle, `${escapedTitle}%`, `%${escapedTitle}%`, `${escapedTitle}%`, `%${escapedTitle}%`]
  );

  const bestCandidate = pickBestAnimeTitleCandidate(rows, normalizedTitle);
  if (!bestCandidate) {
    return null;
  }

  return mapRowToAnimeRecord(bestCandidate);
}

export async function listAnimeRecordsByExactTitle(title: string): Promise<AnimeRecord[]> {
  const rows = await query<AnimeRow[]>('SELECT * FROM anime WHERE title = ? ORDER BY createdAt DESC', [title]);
  return rows.map(mapRowToAnimeRecord);
}

export async function updateAnimeProgress(id: number, progress: number): Promise<void> {
    await query('UPDATE anime SET progress = ?, updatedAt = NOW() WHERE id = ?', [progress, id]);
}
