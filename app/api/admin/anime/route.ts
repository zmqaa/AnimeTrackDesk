import { apiSuccess, apiError, requireAdmin } from '@/lib/api-response';
import { query } from '@/lib/db';
import { type RowDataPacket, type ResultSetHeader } from 'mysql2';

export async function GET(request: Request) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') ?? '50'), 10), 200);
  const search = searchParams.get('search') || undefined;

  const offset = (page - 1) * pageSize;
  const params: (string | number)[] = [];

  let where = '';
  if (search) {
    where = 'WHERE title LIKE ? OR original_title LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  const countRows = await query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM anime ${where}`, params);
  const total = countRows[0].total;

  const selectParams = [...params, Math.floor(pageSize), Math.floor(offset)];
  const rows = await query<RowDataPacket[]>(
    `SELECT id, title, original_title, status, score, progress, totalEpisodes, 
            DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') as createdAt
     FROM anime ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    selectParams
  );

  return apiSuccess({ records: rows, total, page, pageSize });
}

export async function DELETE(request: Request) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const body = await request.json();
  const ids: unknown = body.ids;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return apiError('请提供有效的 ID 数组', 400);
  }

  if (ids.length > 100) {
    return apiError('单次最多删除 100 条记录', 400);
  }

  const placeholders = ids.map(() => '?').join(',');
  // Delete related history first
  await query<ResultSetHeader>(`DELETE FROM watch_history WHERE animeId IN (${placeholders})`, ids);
  const result = await query<ResultSetHeader>(`DELETE FROM anime WHERE id IN (${placeholders})`, ids);

  return apiSuccess({ deleted: result.affectedRows });
}
