import { getWatchHistoryPaginated, deleteWatchHistoryBatch } from '@/lib/history';
import { apiSuccess, apiError, requireAdmin } from '@/lib/api-response';

export async function GET(request: Request) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') ?? '50'), 10), 200);
  const search = searchParams.get('search') || undefined;

  const { records, total } = await getWatchHistoryPaginated(page, pageSize, search);
  return apiSuccess({ records, total, page, pageSize });
}

export async function DELETE(request: Request) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const body = await request.json();
  const ids: unknown = body.ids;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return apiError('请提供有效的记录 ID 数组', 400);
  }

  if (ids.length > 500) {
    return apiError('单次最多删除 500 条记录', 400);
  }

  const deleted = await deleteWatchHistoryBatch(ids as number[]);
  return apiSuccess({ deleted });
}
