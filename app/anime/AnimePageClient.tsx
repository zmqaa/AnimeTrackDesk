"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { MagnifyingGlassIcon, Squares2X2Icon, ListBulletIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import AnimeHeader from '@/components/anime/AnimeHeader';
import AnimeFilterBar from '@/components/anime/AnimeFilterBar';
import AnimeForm from '@/components/anime/AnimeForm';
import AnimeGrid, { type ViewMode } from '@/components/anime/AnimeGrid';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { fetchJson } from '@/lib/client-api';
import type { AnimeStatus, AnimeSortBy, SessionUser, AnimeListItem, AnimeCardItem } from '@/lib/anime-shared';
import AnimePagination from './AnimePagination';
import AnimeQuickRecordPanel from './AnimeQuickRecordPanel';
import AnimeSidebar from './AnimeSidebar';
import { readSessionCache, writeSessionCache } from '@/lib/hooks-shared';
import {
  buildQuickRecordMessage,
  buildRecentWatchItems,
  buildTagPreferences,
  buildVoiceActorSuggestions,
  filterAndSortAnimeItems,
  QuickRecordResponse,
} from './anime-page-helpers';

const ANIME_LIST_CACHE_KEY = 'anime-list-items';
const ANIME_LIST_SCROLL_KEY = 'anime-list-scroll-y';

function getInitialAnimeListCache() {
  return readSessionCache<AnimeListItem[]>(ANIME_LIST_CACHE_KEY);
}

export default function AnimePageClient() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = (session?.user as SessionUser | undefined)?.role === 'admin';
  const [items, setItems] = useState<AnimeListItem[]>(() => getInitialAnimeListCache() || []);
  const [loading, setLoading] = useState(() => getInitialAnimeListCache() === null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [quickInput, setQuickInput] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickMessage, setQuickMessage] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('anime_view_mode') as ViewMode) || 'grid';
    }
    return 'grid';
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; title: string } | null>(null);
  
  // 筛选与排序状态
  const [filterStatus, setFilterStatus] = useState<AnimeStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [castQuery, setCastQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState<AnimeSortBy>('lastWatchedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const hasSyncedUrlFilters = useRef(false);
  const lastFilterKeyRef = useRef('');
  const hasRestoredScrollRef = useRef(false);
  
  // 从 URL 读取页码，默认 1，缺失时回退 sessionStorage
  const currentPage = useMemo(() => {
    const urlPage = Number(searchParams.get('page'));
    return Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;
  }, [searchParams]);

  const setCurrentPage = useCallback((page: number) => {
    const nextPage = Math.max(1, page);
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage === 1) {
      params.delete('page');
    } else {
      params.set('page', String(nextPage));
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    sessionStorage.setItem('anime_last_page', String(nextPage));
  }, [pathname, router, searchParams]);

  // 缺少页码时，用上次停留的页码填充 URL
  useEffect(() => {
    if (!searchParams.get('page')) {
      const cached = sessionStorage.getItem('anime_last_page');
      if (cached) {
        const cachedPage = Number(cached);
        if (Number.isFinite(cachedPage) && cachedPage > 0) {
          setCurrentPage(cachedPage);
        }
      }
    }
  }, [searchParams, setCurrentPage]);

  const pageSize = 12;
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  // 表单初始数据
  const [formData, setFormData] = useState({
    title: '',
    originalTitle: '',
    progress: '0',
    totalEpisodes: '',
    status: 'watching' as AnimeStatus,
    notes: '',
    coverUrl: '',
    tags: '',
    durationMinutes: '',
    startDate: '',
    endDate: '',
    isFinished: false,
  });

  const loadItems = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    if (showLoading) {
      setLoading(true);
    }

    try {
      const data = await fetchJson<AnimeListItem[]>(`/api/anime?_t=${Date.now()}`, undefined, '加载番剧失败');
      const entries = Array.isArray(data) ? data : [];
      setItems(entries);
      writeSessionCache(ANIME_LIST_CACHE_KEY, entries);
    } catch (err) {
      console.error('Failed to load anime:', err);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const cached = readSessionCache<AnimeListItem[]>(ANIME_LIST_CACHE_KEY);
    if (cached) {
      setItems(cached);
      setLoading(false);
      void loadItems({ showLoading: false });
      return;
    }

    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) {
      return;
    }

    const rawScroll = sessionStorage.getItem(ANIME_LIST_SCROLL_KEY);
    if (!rawScroll) {
      return;
    }

    const scrollY = Number(rawScroll);
    if (!Number.isFinite(scrollY) || scrollY < 0) {
      sessionStorage.removeItem(ANIME_LIST_SCROLL_KEY);
      return;
    }

    hasRestoredScrollRef.current = true;
    sessionStorage.removeItem(ANIME_LIST_SCROLL_KEY);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  }, [loading]);

  useEffect(() => {
    if (hasSyncedUrlFilters.current) {
      return;
    }

    const castFromUrl = searchParams.get('cast')?.trim();
    const tagFromUrl = searchParams.get('tag')?.trim();
    const statusFromUrl = searchParams.get('status')?.trim();

    if (castFromUrl) {
      setCastQuery(castFromUrl);
    }

    if (tagFromUrl) {
      setTagFilter(tagFromUrl);
    }

    if (statusFromUrl && ['watching', 'completed', 'dropped', 'plan_to_watch'].includes(statusFromUrl)) {
      setFilterStatus(statusFromUrl as AnimeStatus);
    }

    hasSyncedUrlFilters.current = true;
  }, [searchParams]);

  const filterStateKey = useMemo(
    () => [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder].join('||'),
    [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder]
  );

  useEffect(() => {
    if (!lastFilterKeyRef.current) {
      lastFilterKeyRef.current = filterStateKey;
      return;
    }

    if (lastFilterKeyRef.current === filterStateKey) {
      return;
    }

    lastFilterKeyRef.current = filterStateKey;
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, filterStateKey, setCurrentPage]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      title: '',
      originalTitle: '',
      progress: '0',
      totalEpisodes: '',
      status: 'watching',
      notes: '',
      coverUrl: '',
      tags: '',
      durationMinutes: '',
      startDate: '',
      endDate: '',
      isFinished: false,
    });
  };

  const startEdit = (item: AnimeCardItem) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      originalTitle: item.originalTitle || '',
      progress: String(item.progress),
      totalEpisodes: item.totalEpisodes ? String(item.totalEpisodes) : '',
      status: item.status,
      notes: item.notes || '',
      coverUrl: item.coverUrl || '',
      tags: item.tags ? item.tags.join(', ') : '',
      durationMinutes: item.durationMinutes ? String(item.durationMinutes) : '',
      startDate: item.startDate || '',
      endDate: item.endDate || '',
      isFinished: item.isFinished || false,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    sessionStorage.setItem('anime_view_mode', mode);
  }, []);

  const updateProgress = async (id: number, current: number, total?: number | null) => {
    if (current < 0) return;
    try {
      const isFinishing = total && current >= total;
      await fetchJson<{ ok: true; entry: AnimeListItem }>(`/api/anime/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          progress: current,
          status: isFinishing ? 'completed' : undefined,
          recordHistory: true
        })
      }, '更新失败，请重试');
      loadItems();
      if (isFinishing) {
        toast.success('🎉 恭喜完结！');
      } else {
        toast.success(`已更新进度至 EP ${current}`);
      }
    } catch (err) {
      console.error('Update failed:', err);
      toast.error(err instanceof Error ? err.message : '更新失败，请重试');
    }
  };

  const deleteAnime = async (id: number) => {
    const item = items.find(i => i.id === id);
    setDeleteConfirm({ id, title: item?.title || '这部番剧' });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await fetchJson<{ ok: true }>(`/api/anime/${id}`, { method: 'DELETE' }, '删除失败');
      setItems(prev => prev.filter(item => item.id !== id));
      resetForm();
      toast.success('已删除');
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error(err instanceof Error ? err.message : '删除失败，请重试');
    }
  };

  const handleQuickRecord = async () => {
    const text = quickInput.trim();
    if (!text) {
      setQuickMessage('请输入一句话记录');
      return;
    }

    setQuickLoading(true);
    setQuickMessage('');

    try {
      const data = await fetchJson<QuickRecordResponse>('/api/anime/quick-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }, 'AI录入失败');

      await loadItems();
      setQuickInput('');
      toast.success('AI 录入成功');
      setQuickMessage(buildQuickRecordMessage(data));
    } catch (error) {
      console.error('Quick record failed:', error);
      const message = error instanceof Error ? error.message : 'AI录入失败，请稍后重试';
      setQuickMessage(message);
      toast.error(message);
    } finally {
      setQuickLoading(false);
    }
  };

  const voiceActorSuggestions = useMemo(() => {
    return buildVoiceActorSuggestions(items);
  }, [items]);

  const tagPreferences = useMemo(() => {
    return buildTagPreferences(items);
  }, [items]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter((current) => (current === tag ? '' : tag));
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, setCurrentPage]);

  const recentWatchItems = useMemo(() => {
    return buildRecentWatchItems(items);
  }, [items]);

  const filteredItems = useMemo(() => {
    return filterAndSortAnimeItems(items, {
      filterStatus,
      searchQuery,
      castQuery,
      tagFilter,
      sortBy,
      sortOrder,
    });
  }, [items, filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (safePage !== currentPage) {
      setCurrentPage(safePage);
    }
  }, [safePage, currentPage, loading, setCurrentPage]);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  const rememberListScroll = useCallback(() => {
    sessionStorage.setItem(ANIME_LIST_SCROLL_KEY, String(window.scrollY));
  }, []);

  return (
    <main className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 pb-20">
      <AnimeHeader 
        showForm={showForm}
        editingId={editingId}
        setShowForm={setShowForm}
        resetForm={resetForm}
        isAdmin={isAdmin}
      />

      {isAdmin && (
        <AnimeQuickRecordPanel
          quickInput={quickInput}
          quickLoading={quickLoading}
          quickMessage={quickMessage}
          onInputChange={setQuickInput}
          onSubmit={handleQuickRecord}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="space-y-4">
            {/* 搜索框 + 视图切换 */}
            <div className="flex gap-3">
              <div className="theme-focus-parent relative group shadow-sm flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="theme-focus-icon h-5 w-5 text-zinc-500 transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="搜索番剧、原名或声优..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="surface-input theme-focus-accent block w-full pl-11 pr-4 py-3 rounded-2xl text-white placeholder-zinc-500 transition-all shadow-xl"
                />
              </div>
              <div className="surface-card-muted flex items-center rounded-2xl overflow-hidden flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleViewMode('grid')}
                  className={`p-3 transition-all ${viewMode === 'grid' ? 'theme-accent-soft' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                  aria-label="网格视图"
                >
                  <Squares2X2Icon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleViewMode('list')}
                  className={`p-3 transition-all ${viewMode === 'list' ? 'theme-accent-soft' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                  aria-label="列表视图"
                >
                  <ListBulletIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <AnimeFilterBar 
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              castQuery={castQuery}
              setCastQuery={setCastQuery}
              voiceActorSuggestions={voiceActorSuggestions}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              itemsCount={filteredItems.length}
            />

            {tagFilter && (
              <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-2">
                <span className="text-xs text-purple-200">已按标签筛选：#{tagFilter}</span>
                <button
                  type="button"
                  onClick={() => setTagFilter('')}
                  className="text-[11px] text-purple-200/80 hover:text-white"
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {isAdmin && showForm && (
            <AnimeForm 
              key={editingId || 'new'}
              editingId={editingId}
              initialData={formData}
              resetForm={resetForm}
              loadItems={loadItems}
              deleteAnime={deleteAnime}
            />
          )}

          <AnimeGrid 
            items={pagedItems}
            onEdit={startEdit}
            updateProgress={updateProgress}
            loading={loading}
            isAdmin={isAdmin}
            viewMode={viewMode}
            detailReturnTo={returnTo}
            onOpenDetail={rememberListScroll}
          />

          <AnimePagination
            loading={loading}
            itemsCount={filteredItems.length}
            currentPage={safePage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>

        <AnimeSidebar
          items={items}
          tagPreferences={tagPreferences}
          tagFilter={tagFilter}
          recentWatchItems={recentWatchItems}
          isAdmin={isAdmin}
          onToggleTagFilter={toggleTagFilter}
          onEdit={startEdit}
        />
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="删除番剧"
        message={`确定要删除「${deleteConfirm?.title || ''}」吗？删除后其观看历史也会一并清除，无法恢复。`}
        confirmText="确认删除"
        cancelText="再想想"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </main>
  );
}

