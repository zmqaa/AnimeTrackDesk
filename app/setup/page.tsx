"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client-api';

type SetupStatus = {
  allowed: boolean;
  envReady: boolean;
  databaseReachable: boolean;
  seeded: boolean;
  animeCount: number;
  historyCount: number;
  message: string;
  missingEnvKeys: string[];
  envFileHint: string;
  databaseError?: string;
};

const DEFAULT_STATUS: SetupStatus = {
  allowed: true,
  envReady: false,
  databaseReachable: false,
  seeded: false,
  animeCount: 0,
  historyCount: 0,
  message: '正在检查本地初始化状态...',
  missingEnvKeys: [],
  envFileHint: '推荐先复制 .env.example 到 .env.local。',
};

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus>(DEFAULT_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const envTemplate = [
    'MYSQL_HOST=127.0.0.1',
    'MYSQL_PORT=3306',
    'MYSQL_USER=root',
    'MYSQL_PASSWORD=your_mysql_password',
    'MYSQL_DATABASE=anime_track',
    'NEXTAUTH_URL=http://localhost:3000',
    'NEXTAUTH_SECRET=replace_with_a_random_string',
    '# AI_API_KEY=optional',
  ].join('\n');

  const loadStatus = async () => {
    setIsLoading(true);
    setError('');

    try {
      const payload = await fetchJson<SetupStatus>('/api/setup/bootstrap', { cache: 'no-store' }, '读取初始化状态失败');
      setStatus(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取初始化状态失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleBootstrap = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const payload = await fetchJson<{ ok: true; status: SetupStatus }>('/api/setup/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, '初始化失败');

      setStatus(payload.status as SetupStatus);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '初始化失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="glass-panel-strong rounded-[32px] p-6 lg:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="theme-accent-soft inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.3em]">
                Local Setup
              </div>
              <div>
                <h1 className="text-2xl font-display text-zinc-100 lg:text-3xl">本地初始化向导</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  这个页面只用于本地 / 开发环境。它会创建数据库、建表，并导入仓库里的示例番剧与观看历史数据，不会导入用户表数据。
                </p>
              </div>
            </div>
            <div className="surface-card rounded-[24px] px-4 py-3 text-sm text-zinc-300">
              <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">当前状态</div>
              <div className="mt-2 font-medium text-zinc-100">{isLoading ? '检查中...' : status.message}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="glass-panel rounded-[28px] p-5">
            <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">环境变量</div>
            <div className={`mt-3 text-lg font-semibold ${status.envReady ? 'theme-accent-text' : 'text-amber-300'}`}>
              {status.envReady ? '已配置' : '待配置'}
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{status.envFileHint}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">数据库连接</div>
            <div className={`mt-3 text-lg font-semibold ${status.databaseReachable ? 'theme-accent-text' : 'text-zinc-200'}`}>
              {status.databaseReachable ? '可连接' : '未连接'}
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">如果 MySQL 用户有建库权限，按钮会自动创建数据库。</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">示例数据</div>
            <div className={`mt-3 text-lg font-semibold ${status.seeded ? 'theme-secondary-text' : 'text-zinc-200'}`}>
              {status.seeded ? `${status.animeCount} 部作品` : '尚未导入'}
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">观看历史 {status.historyCount} 条，用户数据不会被写入仓库示例。</p>
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-6 lg:p-8 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">初始化步骤</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              先复制 .env.example 为 .env.local 并填好 MySQL 账号密码。AI 的 AI_API_KEY 可以先不填，不影响本地把页面跑起来。
            </p>
          </div>

          <div className="surface-card rounded-[24px] p-4 text-sm leading-6 text-zinc-300">
            <div>1. 准备本地 MySQL 服务</div>
            <div>2. 配置 .env.local 中的 MYSQL_* / NEXTAUTH_* </div>
            <div>3. 点下面按钮自动建库、建表并导入示例数据</div>
            <div>4. 初始化完成后可直接浏览首页；需要编辑时手动打开 /login 登录管理员账号</div>
          </div>

          <div className="surface-card rounded-[24px] p-4 lg:p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">最小 .env.local 模板</div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">如果你不知道该填什么，可以先按这个最小模板准备本地环境变量。</p>
            <pre className="mt-4 overflow-x-auto rounded-[20px] border border-white/6 bg-black/30 p-4 text-xs leading-6 text-zinc-200">{envTemplate}</pre>
          </div>

          {status.missingEnvKeys.length > 0 && (
            <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-amber-200/80">缺少环境变量</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {status.missingEnvKeys.map((item) => (
                  <span key={item} className="rounded-full border border-amber-300/20 bg-black/20 px-3 py-1 text-xs text-amber-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {status.databaseError && !status.databaseReachable && (
            <div className="rounded-[24px] border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              <div className="text-[10px] uppercase tracking-[0.28em] text-red-200/80">数据库错误</div>
              <div className="mt-2 break-all">{status.databaseError}</div>
            </div>
          )}

          {status.databaseReachable && !status.seeded && !error && (
            <div className="theme-secondary-soft rounded-[24px] p-4 text-sm leading-6">
              <div className="text-[10px] uppercase tracking-[0.28em] theme-accent-text-muted">当前判断</div>
              <div className="mt-2">数据库已经能连上，接下来只需要点“一键初始化数据库与示例数据”就能把页面内容准备好。</div>
            </div>
          )}

          {status.seeded && (
            <div className="theme-accent-soft rounded-[24px] p-4 lg:p-5">
              <div className="theme-accent-text-muted text-[10px] uppercase tracking-[0.28em]">初始化完成后的下一步</div>
              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-2 text-sm leading-6 text-zinc-100">
                  <div>数据库已经准备好了，当前已导入 {status.animeCount} 部作品和 {status.historyCount} 条观看历史。</div>
                  <div>现在你可以直接访问首页公开浏览；如果需要编辑内容，请手动打开 /login 登录管理员账号。</div>
                </div>
                <div className="flex flex-col gap-3">
                  <Link href="/login" className="theme-accent-soft rounded-full px-4 py-3 text-center text-sm transition hover:bg-black/30">
                    打开管理员登录页
                  </Link>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-[20px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleBootstrap}
              disabled={isSubmitting || !status.allowed}
              className="theme-accent-button rounded-full px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? '正在初始化...' : '一键初始化数据库与示例数据'}
            </button>
            <button
              type="button"
              onClick={loadStatus}
              disabled={isLoading}
              className="surface-pill rounded-full px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
            >
              刷新状态
            </button>
            <Link href="/login" className="surface-pill rounded-full px-5 py-3 text-sm text-zinc-400 transition hover:border-white/15 hover:text-zinc-200">
              打开管理员登录页
            </Link>
          </div>

          <div className="text-xs leading-6 text-zinc-500">
            如果你是在编辑器里查看仓库，README 顶部保留了最基本的启动说明。
          </div>
        </section>
      </div>
    </div>
  );
}