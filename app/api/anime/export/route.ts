import { listAnimeRecords } from '@/lib/anime';
import { apiSuccess, requireAdmin } from '@/lib/api-response';

export async function GET() {
  const auth = await requireAdmin('只有管理员可以导出数据');
  if (!auth.authorized) {
    return auth.response;
  }

  const records = await listAnimeRecords();
  return apiSuccess({ count: records.length, records });
}
