import { apiError } from '@/lib/api-response';

export async function POST() {
  return apiError('当前部署已关闭公开注册，请使用管理员账号登录。', 403);
}
