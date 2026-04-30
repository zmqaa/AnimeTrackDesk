"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { fetchJson } from '@/lib/client-api';
import {
  Checkbox,
  DeleteButton,
  DeleteIconButton,
  Pagination,
  SearchBar,
  SkeletonRows,
  useDebouncedSearch,
  useSelectableRows,
} from './admin-table-shared';

type SessionUser = { role?: string };
type TabKey = 'anime' | 'history';

interface AnimeRow {
  id: number;
  title: string;
  original_title: string | null;
  status: string;
  score: number | null;
  progress: number;
  totalEpisodes: number | null;
  createdAt: string;
}

interface HistoryRow {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  watching: '追番中',
  completed: '已看完',
  dropped: '已弃坑',
  plan_to_watch: '计划看',
};

const STATUS_COLOR: Record<string, string> = {
  watching: 'text-emerald-400',
  completed: 'text-blue-400',
  dropped: 'text-zinc-500',
  plan_to_watch: 'text-amber-400',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────
// Anime Records Tab
// ─────────────────────────────────────────────

function AnimeTab() {
  const [records, setRecords] = useState<AnimeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: number[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { selected, clearSelection, removeSelected, toggleSelect, toggleSelectAll } = useSelectableRows(records);
  const { search, searchInput, handleSearchInput } = useDebouncedSearch(() => {
    setPage(1);
    clearSelection();
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = records.length > 0 && records.every((record) => selected.has(record.id));

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const data = await fetchJson<{ records: AnimeRow[]; total: number }>(`/api/admin/anime?${params}`, undefined, '加载番剧列表失败');
      setRecords(data.records);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载番剧列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleDelete = async (ids: number[]) => {
    setDeleting(true);
    try {
      await fetchJson<{ deleted: number }>('/api/admin/anime', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }, '删除失败');
      toast.success(`已删除 ${ids.length} 条番剧记录`);
      removeSelected(ids);
      fetchRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <SearchBar value={searchInput} onChange={handleSearchInput} placeholder="搜索番剧名称..." />
        <DeleteButton count={selected.size} onClick={() => setConfirmDelete({ ids: Array.from(selected) })} disabled={deleting} />
      </div>

      <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-zinc-400 text-left text-sm">
                <th className="px-5 py-4 w-12"><Checkbox checked={allSelected} onChange={toggleSelectAll} /></th>
                <th className="px-5 py-4 font-medium">ID</th>
                <th className="px-5 py-4 font-medium">标题</th>
                <th className="px-5 py-4 font-medium">状态</th>
                <th className="px-5 py-4 font-medium">评分</th>
                <th className="px-5 py-4 font-medium">进度</th>
                <th className="px-5 py-4 font-medium">创建时间</th>
                <th className="px-5 py-4 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={8} />
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-zinc-500 text-base">
                    {search ? '没有找到匹配的番剧' : '暂无番剧记录'}
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className={`border-b border-white/[0.03] transition-colors ${selected.has(r.id) ? 'bg-emerald-400/[0.04]' : 'hover:bg-white/[0.02]'}`}>
                    <td className="px-5 py-4"><Checkbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td className="px-5 py-4 text-zinc-500 tabular-nums text-sm">{r.id}</td>
                    <td className="px-5 py-4">
                      <div className="text-zinc-200 font-medium text-base truncate max-w-xs" title={r.title}>{r.title}</div>
                      {r.original_title && (
                        <div className="text-zinc-500 text-sm mt-0.5 truncate max-w-xs" title={r.original_title}>{r.original_title}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-medium ${STATUS_COLOR[r.status] || 'text-zinc-400'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-zinc-300 tabular-nums text-sm">{r.score != null ? `${r.score} 分` : '—'}</td>
                    <td className="px-5 py-4 text-zinc-300 tabular-nums text-sm">
                      {r.progress}{r.totalEpisodes ? ` / ${r.totalEpisodes}` : ''} 集
                    </td>
                    <td className="px-5 py-4 text-zinc-400 tabular-nums text-sm">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-4">
                      <DeleteIconButton onClick={() => setConfirmDelete({ ids: [r.id] })} disabled={deleting} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="确认删除番剧"
        message={
          confirmDelete && confirmDelete.ids.length > 1
            ? `确定要删除选中的 ${confirmDelete.ids.length} 部番剧吗？相关的观看记录也会一起删除，此操作不可撤销。`
            : '确定要删除这部番剧吗？相关的观看记录也会一起删除，此操作不可撤销。'
        }
        confirmText="删除"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.ids)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────
// History Records Tab
// ─────────────────────────────────────────────

function HistoryTab() {
  const [records, setRecords] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: number[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { selected, clearSelection, removeSelected, toggleSelect, toggleSelectAll } = useSelectableRows(records);
  const { search, searchInput, handleSearchInput } = useDebouncedSearch(() => {
    setPage(1);
    clearSelection();
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = records.length > 0 && records.every((record) => selected.has(record.id));

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const data = await fetchJson<{ records: HistoryRow[]; total: number }>(`/api/admin/history?${params}`, undefined, '加载历史记录失败');
      setRecords(data.records);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载历史记录失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleDelete = async (ids: number[]) => {
    setDeleting(true);
    try {
      if (ids.length === 1) {
        await fetchJson<{ deleted: true }>(`/api/admin/history/${ids[0]}`, { method: 'DELETE' }, '删除失败');
      } else {
        await fetchJson<{ deleted: number }>('/api/admin/history', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        }, '删除失败');
      }
      toast.success(`已删除 ${ids.length} 条记录`);
      removeSelected(ids);
      fetchRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <SearchBar value={searchInput} onChange={handleSearchInput} placeholder="搜索番剧名称..." />
        <DeleteButton count={selected.size} onClick={() => setConfirmDelete({ ids: Array.from(selected) })} disabled={deleting} />
      </div>

      <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-zinc-400 text-left text-sm">
                <th className="px-5 py-4 w-12"><Checkbox checked={allSelected} onChange={toggleSelectAll} /></th>
                <th className="px-5 py-4 font-medium">ID</th>
                <th className="px-5 py-4 font-medium">番剧名称</th>
                <th className="px-5 py-4 font-medium">集数</th>
                <th className="px-5 py-4 font-medium">观看时间</th>
                <th className="px-5 py-4 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={6} />
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-zinc-500 text-base">
                    {search ? '没有找到匹配的记录' : '暂无历史记录'}
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className={`border-b border-white/[0.03] transition-colors ${selected.has(r.id) ? 'bg-emerald-400/[0.04]' : 'hover:bg-white/[0.02]'}`}>
                    <td className="px-5 py-4"><Checkbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td className="px-5 py-4 text-zinc-500 tabular-nums text-sm">{r.id}</td>
                    <td className="px-5 py-4 text-zinc-200 font-medium text-base truncate max-w-xs" title={r.animeTitle}>{r.animeTitle}</td>
                    <td className="px-5 py-4 text-zinc-300 tabular-nums text-sm">第 {r.episode} 集</td>
                    <td className="px-5 py-4 text-zinc-400 tabular-nums text-sm">{formatDate(r.watchedAt)}</td>
                    <td className="px-5 py-4">
                      <DeleteIconButton onClick={() => setConfirmDelete({ ids: [r.id] })} disabled={deleting} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="确认删除"
        message={
          confirmDelete && confirmDelete.ids.length > 1
            ? `确定要删除选中的 ${confirmDelete.ids.length} 条观看记录吗？此操作不可撤销。`
            : '确定要删除这条观看记录吗？此操作不可撤销。'
        }
        confirmText="删除"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.ids)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function AdminPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as SessionUser | undefined)?.role;

  const [activeTab, setActiveTab] = useState<TabKey>('anime');

  useEffect(() => {
    if (status === 'authenticated' && role !== 'admin') {
      router.replace('/');
    }
  }, [status, role, router]);

  if (status === 'loading' || (status === 'authenticated' && role !== 'admin')) {
    return <main className="p-6 text-zinc-400">验证权限中...</main>;
  }

  return (
    <main className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-display tracking-tight text-zinc-100">数据管理</h1>
        <p className="text-base text-zinc-500 mt-2">管理番剧条目和观看记录</p>
      </div>

      {/* Tabs */}
      <div className="surface-card-muted flex gap-1 p-1 rounded-2xl w-fit">
        {([
          { key: 'anime' as TabKey, label: '番剧记录', count: null },
          { key: 'history' as TabKey, label: '观看历史', count: null },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-white/10 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'anime' ? <AnimeTab /> : <HistoryTab />}
    </main>
  );
}
