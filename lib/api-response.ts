import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import type { SessionUser } from '@/lib/anime-shared';

export function apiSuccess<T>(data: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function apiError(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
}

export async function requireAdmin(message = '只有管理员可以执行此操作') {
  const session = await getServerSession(authOptions);
  const role = (session?.user as SessionUser | undefined)?.role;
  if (role !== 'admin') {
    return { authorized: false as const, response: apiError(message, 403) };
  }
  return { authorized: true as const, session };
}
