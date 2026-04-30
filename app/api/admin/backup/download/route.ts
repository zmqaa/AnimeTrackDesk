import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { apiError, requireAdmin } from '@/lib/api-response';


const BACKUPS_DIR = path.join(process.cwd(), 'backups');

/** GET — download a backup file */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin('需要管理员权限');
  if (!auth.authorized) {
    return auth.response;
  }

  const fileName = request.nextUrl.searchParams.get('file');
  if (!fileName) {
    return apiError('缺少文件名参数', 400);
  }

  // Security: prevent path traversal, only allow .sql files from backups dir
  const baseName = path.basename(fileName);
  if (baseName !== fileName || !baseName.endsWith('.sql') || baseName.includes('..')) {
    return apiError('无效的文件名', 400);
  }

  const filePath = path.join(BACKUPS_DIR, baseName);

  // Ensure resolved path is within backups dir
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(BACKUPS_DIR))) {
    return apiError('无效的文件路径', 400);
  }

  if (!fs.existsSync(filePath)) {
    return apiError('文件不存在', 404);
  }

  const content = fs.readFileSync(filePath);

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${baseName}"`,
    },
  });
}
