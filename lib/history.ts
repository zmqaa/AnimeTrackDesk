import 'server-only';
import { query } from './db';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2';

export interface WatchHistoryRecord {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number; // The episode number watched
  watchedAt: string; // ISO Date string
}

interface WatchHistoryRow extends RowDataPacket {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: Date | string;
}

function mapRowToHistory(row: WatchHistoryRow): WatchHistoryRecord {
    return {
        id: row.id,
        animeId: row.animeId,
        animeTitle: row.animeTitle,
        episode: row.episode,
        watchedAt: row.watchedAt instanceof Date ? row.watchedAt.toISOString() : String(row.watchedAt),
    };
}

export async function getWatchHistory(limit = 1000): Promise<WatchHistoryRecord[]> {
  const rows = await query<WatchHistoryRow[]>('SELECT id, animeId, animeTitle, episode, watchedAt FROM watch_history ORDER BY watchedAt DESC LIMIT ?', [Math.floor(Number(limit))]);
  return rows.map(mapRowToHistory);
}

export async function getWatchHistorySince(since: Date, limit = 1000): Promise<WatchHistoryRecord[]> {
  const rows = await query<WatchHistoryRow[]>(
    'SELECT id, animeId, animeTitle, episode, watchedAt FROM watch_history WHERE watchedAt >= ? ORDER BY watchedAt DESC LIMIT ?',
    [since, Math.floor(Number(limit))]
  );
  return rows.map(mapRowToHistory);
}

export async function addWatchHistory(animeId: number, animeTitle: string, episode: number, date?: Date): Promise<WatchHistoryRecord> {
  const watchedAt = (date || new Date());
  const sql = `
    INSERT INTO watch_history (animeId, animeTitle, episode, watchedAt)
    VALUES (?, ?, ?, ?)
  `;
  
  const result = await query<ResultSetHeader>(sql, [animeId, animeTitle, episode, watchedAt]);
  
  return {
    id: result.insertId,
    animeId,
    animeTitle,
    episode,
    watchedAt: watchedAt instanceof Date ? watchedAt.toISOString() : String(watchedAt),
  };
}

export async function addBatchWatchHistory(animeId: number, animeTitle: string, startEpisode: number, endEpisode: number, date?: Date): Promise<void> {
    if (startEpisode > endEpisode) return;
    
  const watchedAt = date || new Date();
    const values: unknown[] = [];
    const placeholders: string[] = [];
    
    for (let ep = startEpisode; ep <= endEpisode; ep++) {
        placeholders.push('(?, ?, ?, ?)');
        values.push(animeId, animeTitle, ep, watchedAt);
    }
    
    const sql = `
      INSERT INTO watch_history (animeId, animeTitle, episode, watchedAt)
      VALUES ${placeholders.join(', ')}
    `;
    
    await query(sql, values);
}

export async function deleteWatchHistoryByAnime(animeId: number): Promise<void> {
    await query('DELETE FROM watch_history WHERE animeId = ?', [animeId]);
}

export async function deleteWatchHistoryById(id: number): Promise<boolean> {
    const result = await query<ResultSetHeader>('DELETE FROM watch_history WHERE id = ?', [id]);
    return result.affectedRows > 0;
}

export async function deleteWatchHistoryBatch(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await query<ResultSetHeader>(`DELETE FROM watch_history WHERE id IN (${placeholders})`, ids);
    return result.affectedRows;
}

export async function getWatchHistoryPaginated(page: number, pageSize: number, search?: string): Promise<{ records: WatchHistoryRecord[]; total: number }> {
    const offset = (page - 1) * pageSize;
    let countSql = 'SELECT COUNT(*) as total FROM watch_history';
    let dataSql = 'SELECT id, animeId, animeTitle, episode, watchedAt FROM watch_history';
    const params: unknown[] = [];

    if (search) {
        const where = ' WHERE animeTitle LIKE ?';
        countSql += where;
        dataSql += where;
        params.push(`%${search}%`);
    }

    dataSql += ' ORDER BY watchedAt DESC LIMIT ? OFFSET ?';

    const [countResult] = await query<(RowDataPacket & { total: number })[]>(countSql, params);
    const rows = await query<WatchHistoryRow[]>(dataSql, [...params, Math.floor(Number(pageSize)), Math.floor(Number(offset))]);

    return {
        records: rows.map(mapRowToHistory),
        total: countResult.total,
    };
}
