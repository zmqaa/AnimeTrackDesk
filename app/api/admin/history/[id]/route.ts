import { deleteWatchHistoryById } from '@/lib/history';
import { apiSuccess, apiError, requireAdmin } from '@/lib/api-response';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return apiError('无效的记录 ID', 400);
  }

  const deleted = await deleteWatchHistoryById(id);
  if (!deleted) {
    return apiError('记录不存在', 404);
  }

  return apiSuccess({ deleted: true });
}
