"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { fetchBlob, fetchJson } from '@/lib/client-api';

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

type SessionUser = { role?: string };

export default function BackupPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as SessionUser | undefined)?.role;

  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && role !== 'admin') {
      router.replace('/');
    }
  }, [status, role, router]);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ backups: BackupFile[] }>('/api/admin/backup', undefined, '加载备份列表失败');
      setBackups(data.backups);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载备份列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'admin') fetchBackups();
  }, [fetchBackups, role]);

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      await fetchJson<{ success: true }>('/api/admin/backup', { method: 'POST' }, '备份失败');
      toast.success('备份创建成功');
      fetchBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '备份失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = (name: string) => {
    window.open(`/api/admin/backup/download?file=${encodeURIComponent(name)}`, '_blank');
  };

  const handleDeleteBackup = async (name: string) => {
    try {
      await fetchJson<{ success: true }>('/api/admin/backup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }, '删除失败');
      toast.success('已删除备份');
      fetchBackups();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      const blob = await fetchBlob(`/api/admin/export?format=${format}`, undefined, '导出失败');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anime-track-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} 导出成功`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (status === 'loading' || (status === 'authenticated' && role !== 'admin')) {
    return <main className="p-6 text-zinc-400">验证权限中...</main>;
  }

  return (
    <main className="p-4 md:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-display tracking-tight text-zinc-100">备份与导出</h1>
        <p className="text-base text-zinc-500 mt-2">导出数据、创建和管理 SQL 备份文件</p>
      </div>

      {/* Export Section */}
      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8">
        <h2 className="text-lg font-medium text-zinc-200 mb-2">导出数据</h2>
        <p className="text-sm text-zinc-500 mb-5">
          导出全部番剧列表和观看记录。CSV 格式可以直接用 Excel 打开，JSON 适合程序处理或备用。
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleExport('csv')}
            disabled={exporting !== null}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting === 'csv' ? '导出中...' : '导出 CSV（Excel）'}
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={exporting !== null}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium hover:bg-blue-500/20 transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting === 'json' ? '导出中...' : '导出 JSON'}
          </button>
        </div>
      </section>

      {/* Backup Section */}
      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-medium text-zinc-200">SQL 备份</h2>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium hover:bg-violet-500/20 transition-all disabled:opacity-50 w-fit"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {creating ? '备份中...' : '立即备份'}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          备份 anime 和 watch_history 表为 SQL 文件。可用于恢复数据、迁移到其他服务器，或配合 <code className="text-zinc-400">/setup</code> 页面初始化新环境。
        </p>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            暂无备份文件，点击「立即备份」创建第一个
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.name}
                className="surface-card-muted flex items-center justify-between px-5 py-4 rounded-2xl hover:bg-white/[0.04] transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm md:text-base text-zinc-300 truncate font-medium">{backup.name}</p>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1">
                    {formatDate(backup.createdAt)} · {formatSize(backup.size)}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4 shrink-0">
                  <button
                    onClick={() => handleDownload(backup.name)}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-blue-300 hover:bg-blue-500/10 transition-all"
                    title="下载"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(backup.name)}
                    className="p-2.5 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="删除"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="删除备份"
        message={`确定要删除备份文件 ${deleteConfirm} 吗？`}
        confirmText="删除"
        variant="danger"
        onConfirm={() => deleteConfirm && handleDeleteBackup(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </main>
  );
}
