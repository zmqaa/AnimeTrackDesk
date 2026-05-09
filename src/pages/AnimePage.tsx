import AnimeFilterBar from "@/components/anime/AnimeFilterBar";
import type { AnimeFormInitialData, AnimeCardItem, AnimeListItem, AnimeSortBy, AnimeStatus } from "@/lib/anime-shared";
import AnimeForm, { type AnimeFormSubmitPayload } from "@/components/anime/AnimeForm";
import AnimeGrid, { type ViewMode } from "@/components/anime/AnimeGrid";
import AnimeHeader from "@/components/anime/AnimeHeader";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { ListBulletIcon, MagnifyingGlassIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import AnimePagination from "@/src/features/anime/AnimePagination";
import AnimeQuickRecordPanel from "@/src/features/anime/AnimeQuickRecordPanel";
import AnimeSidebar from "@/src/features/anime/AnimeSidebar";
import { buildQuickRecordMessage, buildRecentWatchItems, buildTagPreferences, buildVoiceActorSuggestions, filterAndSortAnimeItems, type QuickRecordResponse } from "@/src/features/anime/anime-page-helpers";
import { quickRecordAnimeFromText, type QuickRecordTraceEvent } from "@/src/lib/quick-record";
import { deleteAnimeItem, loadAnimeListItems, type AnimeUpsertInput, upsertAnimeItem, updateAnimeProgress } from "@/src/lib/anime-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useSearchParams } from "react-router-dom";

const ANIME_LIST_SCROLL_KEY = "anime-list-scroll-y";
const EMPTY_FORM_DATA: AnimeFormInitialData = {
  title: "",
  originalTitle: "",
  progress: "0",
  totalEpisodes: "",
  status: "watching",
  notes: "",
  coverUrl: "",
  tags: "",
  durationMinutes: "",
  startDate: "",
  endDate: "",
  isFinished: false,
};

function parseFilterStatus(value: string | null): AnimeStatus | "all" {
  if (value === "watching" || value === "completed" || value === "dropped" || value === "plan_to_watch") {
    return value;
  }

  return "all";
}

function parseSortBy(value: string | null): AnimeSortBy {
  if (
    value === "lastWatchedAt"
    || value === "updatedAt"
    || value === "createdAt"
    || value === "startDate"
    || value === "endDate"
    || value === "score"
    || value === "progress"
    || value === "title"
  ) {
    return value;
  }

  return "lastWatchedAt";
}

function parseSortOrder(value: string | null): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

export default function AnimePage() {
  const [items, setItems] = useState<AnimeListItem[]>(() => loadAnimeListItems());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<AnimeFormInitialData>(EMPTY_FORM_DATA);
  const [quickInput, setQuickInput] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickMessage, setQuickMessage] = useState("");
  const [quickTrace, setQuickTrace] = useState<QuickRecordTraceEvent[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; title: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (window.sessionStorage.getItem("anime_view_mode") as ViewMode) || "grid";
    }

    return "grid";
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isAdmin = true;
  const hasRestoredScrollRef = useRef(false);
  const lastFilterKeyRef = useRef("");

  const currentPage = useMemo(() => {
    const rawPage = Number(searchParams.get("page"));
    return Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  }, [searchParams]);

  const filterStatus = useMemo(() => parseFilterStatus(searchParams.get("status")), [searchParams]);
  const searchQuery = useMemo(() => searchParams.get("q")?.trim() || "", [searchParams]);
  const castQuery = useMemo(() => searchParams.get("cast")?.trim() || "", [searchParams]);
  const tagFilter = useMemo(() => searchParams.get("tag")?.trim() || "", [searchParams]);
  const sortBy = useMemo(() => parseSortBy(searchParams.get("sortBy")), [searchParams]);
  const sortOrder = useMemo(() => parseSortOrder(searchParams.get("sortOrder")), [searchParams]);
  const detailReturnTo = location.search ? `${location.pathname}${location.search}` : location.pathname;
  const pageSize = 12;

  const updateSearchState = useCallback((updates: {
    page?: number | null;
    status?: AnimeStatus | "all" | null;
    q?: string | null;
    cast?: string | null;
    tag?: string | null;
    sortBy?: AnimeSortBy | null;
    sortOrder?: "asc" | "desc" | null;
  }) => {
    const nextParams = new URLSearchParams(searchParams);

    if (Object.prototype.hasOwnProperty.call(updates, "page")) {
      if (!updates.page || updates.page <= 1) {
        nextParams.delete("page");
      } else {
        nextParams.set("page", String(updates.page));
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "status")) {
      if (!updates.status || updates.status === "all") {
        nextParams.delete("status");
      } else {
        nextParams.set("status", updates.status);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "q")) {
      const normalizedQuery = updates.q?.trim();
      if (!normalizedQuery) {
        nextParams.delete("q");
      } else {
        nextParams.set("q", normalizedQuery);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "cast")) {
      const normalizedCast = updates.cast?.trim();
      if (!normalizedCast) {
        nextParams.delete("cast");
      } else {
        nextParams.set("cast", normalizedCast);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "tag")) {
      const normalizedTag = updates.tag?.trim();
      if (!normalizedTag) {
        nextParams.delete("tag");
      } else {
        nextParams.set("tag", normalizedTag);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "sortBy")) {
      if (!updates.sortBy || updates.sortBy === "lastWatchedAt") {
        nextParams.delete("sortBy");
      } else {
        nextParams.set("sortBy", updates.sortBy);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "sortOrder")) {
      if (!updates.sortOrder || updates.sortOrder === "desc") {
        nextParams.delete("sortOrder");
      } else {
        nextParams.set("sortOrder", updates.sortOrder);
      }
    }

    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const setCurrentPage = useCallback((page: number) => {
    updateSearchState({ page: Math.max(1, page) });
  }, [updateSearchState]);

  const setFilterStatus = useCallback((status: AnimeStatus | "all") => {
    updateSearchState({ status, page: 1 });
  }, [updateSearchState]);

  const setSearchQuery = useCallback((value: string) => {
    updateSearchState({ q: value, page: 1 });
  }, [updateSearchState]);

  const setCastQuery = useCallback((value: string) => {
    updateSearchState({ cast: value, page: 1 });
  }, [updateSearchState]);

  const setTagFilter = useCallback((value: string) => {
    updateSearchState({ tag: value, page: 1 });
  }, [updateSearchState]);

  const setSortBy = useCallback((value: AnimeSortBy) => {
    updateSearchState({ sortBy: value, page: 1 });
  }, [updateSearchState]);

  const setSortOrder = useCallback((value: "asc" | "desc") => {
    updateSearchState({ sortOrder: value, page: 1 });
  }, [updateSearchState]);

  useEffect(() => {
    if (hasRestoredScrollRef.current) {
      return;
    }

    const rawScroll = window.sessionStorage.getItem(ANIME_LIST_SCROLL_KEY);
    if (!rawScroll) {
      return;
    }

    const scrollY = Number(rawScroll);
    if (!Number.isFinite(scrollY) || scrollY < 0) {
      window.sessionStorage.removeItem(ANIME_LIST_SCROLL_KEY);
      return;
    }

    hasRestoredScrollRef.current = true;
    window.sessionStorage.removeItem(ANIME_LIST_SCROLL_KEY);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  }, []);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setFormData(EMPTY_FORM_DATA);
  }, []);

  const startEdit = useCallback((item: AnimeCardItem) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      originalTitle: item.originalTitle || "",
      progress: String(item.progress),
      totalEpisodes: item.totalEpisodes ? String(item.totalEpisodes) : "",
      status: item.status,
      notes: item.notes || "",
      coverUrl: item.coverUrl || "",
      tags: item.tags?.join(", ") || "",
      durationMinutes: item.durationMinutes ? String(item.durationMinutes) : "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      isFinished: item.isFinished || false,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const toggleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    window.sessionStorage.setItem("anime_view_mode", mode);
  }, []);

  const handleSubmit = useCallback(async (payload: AnimeFormSubmitPayload) => {
    const result = upsertAnimeItem(editingId, payload as AnimeUpsertInput);
    setItems(result.items);
  }, [editingId]);

  const handleDeleteRequest = useCallback(async (id: number) => {
    const currentItem = items.find((item) => item.id === id);
    setDeleteConfirm({
      id,
      title: currentItem?.title || "这部番剧",
    });
  }, [items]);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) {
      return;
    }

    const result = deleteAnimeItem(deleteConfirm.id);
    setItems(result.items);
    setDeleteConfirm(null);
    resetForm();
    toast.success("已删除");
  }, [deleteConfirm, resetForm]);

  const handleQuickRecord = useCallback(async () => {
    const text = quickInput.trim();
    if (!text) {
      setQuickMessage("请输入一句话记录");
      setQuickTrace([]);
      return;
    }

    setQuickLoading(true);
    setQuickMessage("");
    setQuickTrace([]);

    try {
      const data: QuickRecordResponse = await quickRecordAnimeFromText(text, {
        onTrace: (event) => {
          setQuickTrace((current) => [...current, event]);
        },
      });
      setItems(loadAnimeListItems());
      setQuickInput("");
      setQuickMessage(buildQuickRecordMessage(data));
      toast.success("AI 录入成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI录入失败，请稍后重试";
      setQuickMessage(message);
      toast.error(message);
    } finally {
      setQuickLoading(false);
    }
  }, [quickInput]);

  const updateProgress = useCallback(async (id: number, current: number, total?: number | null) => {
    if (current < 0) {
      return;
    }

    const result = updateAnimeProgress(id, current, total);
    setItems(result.items);

    if (result.completedNow) {
      toast.success("🎉 恭喜完结！");
      return;
    }

    toast.success(`已更新进度至 EP ${result.entry.progress}`);
  }, []);

  const rememberListScroll = useCallback(() => {
    window.sessionStorage.setItem(ANIME_LIST_SCROLL_KEY, String(window.scrollY));
  }, []);

  const voiceActorSuggestions = useMemo(() => buildVoiceActorSuggestions(items), [items]);
  const tagPreferences = useMemo(() => buildTagPreferences(items), [items]);
  const recentWatchItems = useMemo(() => buildRecentWatchItems(items), [items]);

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

  const filterStateKey = useMemo(() => [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder].join("||"), [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder]);

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

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (safePage !== currentPage) {
      setCurrentPage(safePage);
    }
  }, [safePage, currentPage, setCurrentPage]);

  const pagedItems = useMemo(() => {
    const startIndex = (safePage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [filteredItems, safePage]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter(tagFilter === tag ? "" : tag);
  }, [setTagFilter, tagFilter]);

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
          quickTrace={quickTrace}
          onInputChange={setQuickInput}
          onSubmit={handleQuickRecord}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="theme-focus-parent relative group shadow-sm flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="theme-focus-icon h-5 w-5 text-zinc-500 transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="搜索番剧、原名或声优..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="surface-input theme-focus-accent block w-full pl-11 pr-4 py-3 rounded-2xl text-white placeholder-zinc-500 transition-all shadow-xl"
                />
              </div>

              <div className="surface-card-muted flex items-center rounded-2xl overflow-hidden flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleViewMode("grid")}
                  className={`p-3 transition-all ${viewMode === "grid" ? "theme-accent-soft" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"}`}
                  aria-label="网格视图"
                >
                  <Squares2X2Icon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleViewMode("list")}
                  className={`p-3 transition-all ${viewMode === "list" ? "theme-accent-soft" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"}`}
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
                  onClick={() => setTagFilter("")}
                  className="text-[11px] text-purple-200/80 hover:text-white"
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {isAdmin && showForm && (
            <AnimeForm
              key={editingId || "new"}
              editingId={editingId}
              initialData={formData}
              onSubmit={handleSubmit}
              resetForm={resetForm}
              deleteAnime={handleDeleteRequest}
            />
          )}

          <AnimeGrid
            items={pagedItems}
            onEdit={startEdit}
            updateProgress={updateProgress}
            loading={false}
            isAdmin={isAdmin}
            viewMode={viewMode}
            detailReturnTo={detailReturnTo}
            onOpenDetail={rememberListScroll}
          />

          <AnimePagination
            loading={false}
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
        open={Boolean(deleteConfirm)}
        title="删除番剧记录"
        message={deleteConfirm ? `确定要删除《${deleteConfirm.title}》吗？相关本地观看历史也会一起移除。` : ""}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </main>
  );
}