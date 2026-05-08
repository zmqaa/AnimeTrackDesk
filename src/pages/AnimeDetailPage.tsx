import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { normalizeStringArray } from "@/lib/anime-cast";
import { analyzeAnimePreferenceInsight } from "@/lib/anime-preference-insights";
import { formatLocalDateString, formatLocalDateTimeString } from "@/lib/local-date-time";
import type { AnimeDetailItem, AnimeStatus } from "@/lib/anime-shared";
import {
  deleteAnimeItem,
  loadAnimeDetailItem,
  loadAnimeListItems,
  type AnimeDetailPatchInput,
  updateAnimeDetailItem,
} from "@/src/lib/anime-store";
import { enrichAnimeEntryMetadata } from "@/src/lib/anime-metadata-enrichment";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

type DateInputHandle = HTMLInputElement & {
  showPicker?: () => void;
};

const statusMap: Record<AnimeStatus, string> = {
  watching: "追番中",
  completed: "已看完",
  dropped: "已弃坑",
  plan_to_watch: "计划看",
};

const statusBadgeStyles: Record<AnimeStatus, string> = {
  watching: "theme-status-watching",
  completed: "theme-status-completed",
  dropped: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  plan_to_watch: "border-violet-400/30 bg-violet-400/10 text-violet-200",
};

const OMIT_FIELD = Symbol("omit-field");
const editableKeys = [
  "title",
  "originalTitle",
  "status",
  "progress",
  "score",
  "totalEpisodes",
  "notes",
  "coverUrl",
  "durationMinutes",
  "tags",
  "summary",
  "startDate",
  "endDate",
  "premiereDate",
  "cast",
  "isFinished",
] as const satisfies readonly (keyof AnimeDetailPatchInput)[];
const arrayKeys = new Set<(typeof editableKeys)[number]>(["tags", "cast"]);
const requiredNumericKeys = new Set<(typeof editableKeys)[number]>(["progress"]);
const nullableNumericKeys = new Set<(typeof editableKeys)[number]>(["score", "totalEpisodes", "durationMinutes"]);
const nullableTextKeys = new Set<(typeof editableKeys)[number]>([
  "originalTitle",
  "notes",
  "coverUrl",
  "summary",
  "startDate",
  "endDate",
  "premiereDate",
]);

type EditableField = (typeof editableKeys)[number];
type AnimeDetailFormData = Partial<AnimeDetailItem> & {
  tags?: AnimeDetailItem["tags"] | string;
  cast?: AnimeDetailItem["cast"] | string;
};

function formatDateLabel(value?: string) {
  return formatLocalDateString(value);
}

function formatTimestampLabel(value?: string) {
  return formatLocalDateTimeString(value);
}

function toTagInputValue(value: AnimeDetailFormData["tags"] | undefined) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value || "";
}

function resolveReturnTo(rawValue: string | null) {
  if (!rawValue) {
    return "/anime";
  }

  return rawValue.startsWith("/anime") ? rawValue : "/anime";
}

function isMissingValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function normalizeEditableFieldValue(key: EditableField, value: unknown): unknown {
  if (arrayKeys.has(key)) {
    return normalizeStringArray(value);
  }

  if (requiredNumericKeys.has(key)) {
    return isMissingValue(value) ? 0 : Number(value);
  }

  if (nullableNumericKeys.has(key)) {
    if (isMissingValue(value)) {
      return null;
    }

    return Number(value);
  }

  if (nullableTextKeys.has(key)) {
    return isMissingValue(value) ? null : value;
  }

  if (key === "isFinished") {
    if (value === undefined) {
      return OMIT_FIELD;
    }

    return Boolean(value);
  }

  return value;
}

function areStringArraysEqual(left: unknown, right: unknown) {
  const leftValues = normalizeStringArray(left) || [];
  const rightValues = normalizeStringArray(right) || [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function isFieldValueUnchanged(key: EditableField, nextValue: unknown, currentValue: unknown) {
  if (arrayKeys.has(key)) {
    return areStringArraysEqual(nextValue, currentValue);
  }

  if (requiredNumericKeys.has(key)) {
    return Number(currentValue ?? 0) === nextValue;
  }

  if (nullableNumericKeys.has(key)) {
    if (nextValue === null) {
      return isMissingValue(currentValue);
    }

    if (currentValue === undefined || currentValue === null || currentValue === "") {
      return false;
    }

    return Number(currentValue) === nextValue;
  }

  if (nullableTextKeys.has(key)) {
    if (nextValue === null) {
      return isMissingValue(currentValue);
    }

    return nextValue === currentValue;
  }

  if (key === "isFinished") {
    return nextValue === currentValue;
  }

  return nextValue === currentValue;
}

function buildChangedPayload(formData: AnimeDetailFormData, item: AnimeDetailItem): AnimeDetailPatchInput {
  const payload: AnimeDetailPatchInput = {};

  for (const key of editableKeys) {
    const normalizedValue = normalizeEditableFieldValue(key, formData[key]);
    if (normalizedValue === OMIT_FIELD) {
      continue;
    }

    if (isFieldValueUnchanged(key, normalizedValue, item[key])) {
      continue;
    }

    (payload as Record<string, unknown>)[key] = normalizedValue;
  }

  return payload;
}

export default function AnimeDetailPage() {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const animeId = useMemo(() => Number(params.id), [params.id]);
  const isAdmin = true;
  const [item, setItem] = useState<AnimeDetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<AnimeDetailFormData>({});
  const [isAiEnriching, setIsAiEnriching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const returnTo = useMemo(() => resolveReturnTo(searchParams.get("returnTo")), [searchParams]);
  const canEdit = isAdmin && isEditing;
  const startDateInputRef = useRef<DateInputHandle | null>(null);
  const endDateInputRef = useRef<DateInputHandle | null>(null);
  const premiereDateInputRef = useRef<DateInputHandle | null>(null);

  useEffect(() => {
    setLoading(true);

    if (!Number.isFinite(animeId) || animeId <= 0) {
      setItem(null);
      setFormData({});
      setLoading(false);
      return;
    }

    try {
      const data = loadAnimeDetailItem(animeId);
      setItem(data);
      setFormData(data || {});
    } catch (error) {
      console.error(error);
      setItem(null);
      setFormData({});
    } finally {
      setLoading(false);
    }
  }, [animeId]);

  useEffect(() => {
    if (!isAdmin) {
      setIsEditing(false);
    }
  }, [isAdmin]);

  const handleReturnToList = () => {
    navigate(returnTo, { replace: false });
  };

  const handleChange = (key: keyof AnimeDetailItem, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const openDatePicker = (input: DateInputHandle | null) => {
    if (!input) {
      return;
    }

    input.focus();
    input.showPicker?.();
  };

  const saveChanges = async () => {
    if (!item || !isAdmin || !Number.isFinite(animeId)) {
      return;
    }

    const payload = buildChangedPayload(formData, item);
    if (Object.keys(payload).length === 0) {
      toast("没有需要保存的变更", { icon: "ℹ️" });
      return;
    }

    setSaving(true);
    try {
      const response = updateAnimeDetailItem(animeId, payload);
      setItem(response.entry);
      setFormData(response.entry);
      setIsEditing(false);
      toast.success("保存成功");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存出错");
    } finally {
      setSaving(false);
    }
  };

  const enrichAnimeInfo = async () => {
    if (!item || !isAdmin || !Number.isFinite(animeId)) {
      return;
    }

    setIsAiEnriching(true);
    try {
      const result = await enrichAnimeEntryMetadata(item);

      if (result.appliedFields.length === 0) {
        if (!result.usedAi && !result.usedProvider) {
          toast("暂时没有拿到可用元数据。若想提高识别率，可先在设置页启用 AI Provider。", { icon: "ℹ️" });
        } else {
          toast("没有可补充的字段", { icon: "ℹ️" });
        }
        return;
      }

      const response = updateAnimeDetailItem(animeId, result.patch);
      setItem(response.entry);
      setFormData(response.entry);

      const sourceLabel = result.usedAi ? "AI + Bangumi" : result.usedProvider ? "Bangumi" : "元数据";
      toast.success(`已通过${sourceLabel}补充 ${result.appliedFields.length} 个字段`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "AI补充失败");
    } finally {
      setIsAiEnriching(false);
    }
  };

  const deleteAnime = async () => {
    if (!isAdmin) {
      return;
    }

    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!Number.isFinite(animeId)) {
      return;
    }

    setShowDeleteConfirm(false);
    try {
      deleteAnimeItem(animeId);
      toast.success("已删除");
      navigate(returnTo, { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const coverUrl = useMemo(() => {
    const editableCover = typeof formData.coverUrl === "string" ? formData.coverUrl : undefined;
    return editableCover || item?.coverUrl || "";
  }, [formData.coverUrl, item?.coverUrl]);

  const displayStatus = ((formData.status as AnimeStatus | undefined) || item?.status || "watching") as AnimeStatus;
  const displayProgress = Number(formData.progress ?? item?.progress ?? 0) || 0;
  const displayTotalEpisodes = Number(formData.totalEpisodes ?? item?.totalEpisodes ?? 0) || undefined;
  const displayDuration = Number(formData.durationMinutes ?? item?.durationMinutes ?? 0) || undefined;
  const displayScoreValue: unknown = formData.score ?? item?.score;
  const displayScore = displayScoreValue === undefined || displayScoreValue === "" || displayScoreValue === null
    ? undefined
    : Number(displayScoreValue);
  const displayTags = useMemo(() => {
    if (canEdit) {
      return normalizeStringArray(formData.tags) || [];
    }

    return Array.isArray(item?.tags) ? item.tags : [];
  }, [canEdit, formData.tags, item?.tags]);
  const displayIsFinished = Boolean(formData.isFinished ?? item?.isFinished);
  const progressPercent = displayTotalEpisodes && displayTotalEpisodes > 0
    ? Math.min(100, (displayProgress / displayTotalEpisodes) * 100)
    : (displayStatus === "completed" ? 100 : Math.min(displayProgress * 8, 100));
  const preferenceInsight = useMemo(() => {
    if (!item) {
      return null;
    }

    return analyzeAnimePreferenceInsight(
      {
        ...item,
        tags: displayTags,
        summary: typeof formData.summary === "string" ? formData.summary : item.summary,
      },
      loadAnimeListItems(),
    );
  }, [displayTags, formData.summary, item]);

  const insightToneStyles = preferenceInsight?.tone === "warning"
    ? "border-rose-400/30 bg-rose-500/10"
    : preferenceInsight?.tone === "mixed"
      ? "border-amber-400/30 bg-amber-500/10"
      : "border-emerald-400/30 bg-emerald-500/10";
  const insightIconStyles = preferenceInsight?.tone === "warning"
    ? "text-rose-200"
    : preferenceInsight?.tone === "mixed"
      ? "text-amber-200"
      : "text-emerald-200";

  if (loading) {
    return <div className="p-12 text-center text-zinc-500 font-mono">LOADING_DETAILS...</div>;
  }

  if (!item) {
    return (
      <div className="p-4 lg:p-8 pb-20">
        <section className="glass-panel-strong rounded-[32px] p-8 lg:p-10 space-y-5 max-w-4xl">
          <button onClick={handleReturnToList} className="flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            <span>返回列表</span>
          </button>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Anime Detail</p>
            <h1 className="text-3xl font-display text-zinc-100 tracking-tight">未找到这部番剧</h1>
            <p className="text-zinc-400 leading-7 max-w-2xl">
              当前本地仓储里没有对应条目，可能已经被删除，或者链接指向了旧数据。
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1660px] px-4 md:px-6 xl:px-8 2xl:px-10 pb-20 animate-in fade-in zoom-in-95 duration-300">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-300/10 shadow-[0_30px_80px_rgba(0,0,0,0.45)]" style={{ backgroundColor: "var(--background)" }}>
        {coverUrl && (
          <div className="absolute inset-0 opacity-[0.08]">
            <img src={coverUrl} alt={item.title} className="h-full w-full scale-110 object-cover blur-3xl" />
          </div>
        )}
        <div className="theme-detail-aura absolute inset-0" />

        <div className="relative p-5 md:p-8 xl:p-10 2xl:p-12">
          <button onClick={handleReturnToList} className="flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            <span>返回列表</span>
          </button>

          <div className="mt-6 grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[390px_minmax(0,1fr)] 2xl:gap-10">
            <aside className="space-y-5 xl:sticky xl:top-8 xl:self-start">
              <div className="glass-panel-strong overflow-hidden rounded-[28px] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                <div className="aspect-[2/3] w-full bg-zinc-900">
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-700">No Image</div>
                  )}
                </div>

                <div className="border-t border-white/5 bg-black/20 p-4">
                  <div className={`rounded-2xl border px-4 py-3 text-center text-sm font-semibold tracking-[0.2em] ${statusBadgeStyles[displayStatus]}`}>
                    {statusMap[displayStatus]}
                  </div>
                </div>
              </div>

              <div className="surface-card rounded-[24px] p-5 2xl:p-6 backdrop-blur-xl">
                {canEdit ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">状态</label>
                      <select
                        value={formData.status || item.status}
                        onChange={(event) => handleChange("status", event.target.value as AnimeStatus)}
                        className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                      >
                        {Object.keys(statusMap).map((status) => (
                          <option key={status} value={status}>{statusMap[status as AnimeStatus]}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">评分</label>
                        <input
                          type="number"
                          value={formData.score ?? ""}
                          onChange={(event) => handleChange("score", event.target.value)}
                          className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">单集时长</label>
                        <input
                          type="number"
                          value={formData.durationMinutes ?? ""}
                          onChange={(event) => handleChange("durationMinutes", event.target.value)}
                          className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">封面链接</label>
                      <input
                        value={formData.coverUrl || ""}
                        onChange={(event) => handleChange("coverUrl", event.target.value)}
                        className="surface-input theme-focus-accent w-full rounded-xl px-3 py-2.5 text-sm text-white transition"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">评分</div>
                      <div className="mt-2 text-lg font-semibold text-amber-300">{displayScore ? `★ ${displayScore}` : "-"}</div>
                    </div>
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">集数</div>
                      <div className="mt-2 text-lg font-semibold text-zinc-100">{displayTotalEpisodes || "?"}</div>
                    </div>
                    <div className="surface-card-muted rounded-2xl p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">时长</div>
                      <div className="mt-2 text-lg font-semibold text-zinc-100">{displayDuration ? `${displayDuration}m` : "-"}</div>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="space-y-6">
              <div className="surface-card rounded-[28px] p-6 md:p-8 xl:p-9 2xl:p-10 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    {canEdit ? (
                      <input
                        value={formData.title || ""}
                        onChange={(event) => handleChange("title", event.target.value)}
                        className="theme-focus-accent w-full border-b border-white/10 bg-transparent pb-2 text-3xl font-semibold tracking-tight text-white transition"
                      />
                    ) : (
                      <h1 className="text-3xl font-semibold tracking-tight text-white md:text-[2.5rem]">{item.title}</h1>
                    )}

                    {canEdit ? (
                      <input
                        value={formData.originalTitle || ""}
                        placeholder="原名 / 日文名"
                        onChange={(event) => handleChange("originalTitle", event.target.value)}
                        className="theme-focus-accent w-full border-b border-white/10 bg-transparent pb-2 text-lg text-zinc-400 transition"
                      />
                    ) : (
                      item.originalTitle && <p className="text-lg text-zinc-400">{item.originalTitle}</p>
                    )}

                    {canEdit ? (
                      <input
                        value={toTagInputValue(formData.tags)}
                        onChange={(event) => handleChange("tags", event.target.value)}
                        placeholder="标签 (逗号分隔)"
                        className="surface-input theme-focus-accent w-full rounded-2xl px-4 py-3 text-sm text-white transition"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {displayTags.map((tag) => (
                          <span key={tag} className="surface-pill rounded-full px-3 py-1 text-xs text-zinc-200">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                    {isAdmin ? (
                      <>
                        {canEdit ? (
                          <>
                            <button
                              onClick={enrichAnimeInfo}
                              disabled={isAiEnriching}
                              className="surface-pill rounded-xl px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isAiEnriching ? "AI补充中..." : "AI补充"}
                            </button>
                            <button onClick={() => setIsEditing(false)} className="rounded-xl px-4 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-900/80 hover:text-white">
                              取消
                            </button>
                            <button
                              onClick={saveChanges}
                              disabled={saving}
                              className="theme-accent-button rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50"
                            >
                              {saving ? "保存中..." : "保存更改"}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={enrichAnimeInfo}
                              disabled={isAiEnriching}
                              className="surface-pill rounded-xl px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isAiEnriching ? "AI补充中..." : "AI补充"}
                            </button>
                            <button
                              onClick={() => setIsEditing(true)}
                              className="surface-pill rounded-xl p-2.5 text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                            >
                              <PencilSquareIcon className="h-5 w-5" />
                            </button>
                          </>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">观看状态</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{statusMap[displayStatus]}</div>
                    <div className="mt-1 text-xs text-zinc-500">{displayIsFinished ? "片源已完结" : "仍可能继续更新"}</div>
                  </div>
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">当前进度</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{displayProgress} / {displayTotalEpisodes || "?"} EP</div>
                    <div className="mt-1 text-xs text-zinc-500">完成度 {Math.round(progressPercent)}%</div>
                  </div>
                  <div className="surface-card-muted rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">最近编辑</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-100">{formatTimestampLabel(item.updatedAt)}</div>
                    <div className="mt-1 text-xs text-zinc-500">创建于 {formatDateLabel(item.createdAt)}</div>
                  </div>
                </div>

                {preferenceInsight ? (
                  <div className={`mt-6 rounded-[24px] border p-5 ${insightToneStyles}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-200/90">
                          <ExclamationTriangleIcon className={`h-4 w-4 ${insightIconStyles}`} />
                          口味雷达
                        </div>
                        <h3 className="text-xl font-semibold text-white">{preferenceInsight.headline}</h3>
                        <p className="max-w-3xl text-sm leading-7 text-zinc-200/85">{preferenceInsight.message}</p>
                        <p className="text-xs leading-6 text-zinc-300/70">{preferenceInsight.profileSummary}</p>
                      </div>

                      {preferenceInsight.favoriteTags.length > 0 ? (
                        <div className="surface-card-muted min-w-[240px] rounded-2xl p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">你的高频标签</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {preferenceInsight.favoriteTags.slice(0, 5).map((tag) => (
                              <span key={tag} className="surface-pill rounded-full px-3 py-1 text-xs text-zinc-200">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {preferenceInsight.reasonBadges.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {preferenceInsight.reasonBadges.map((badge) => (
                          <span key={badge} className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs text-zinc-200/80">
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(320px,0.92fr)] 2xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.95fr)] 2xl:gap-8">
                <div className="space-y-6">
                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                        <CheckCircleIcon className="h-4 w-4" />
                        观看进度
                      </h3>
                      <span className="font-mono text-sm text-zinc-300">
                        {canEdit ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={formData.progress ?? item.progress}
                              onChange={(event) => handleChange("progress", event.target.value)}
                              className="surface-input theme-focus-accent w-20 rounded-xl px-2 py-1.5 text-center text-sm text-white transition"
                            />
                            <span>/</span>
                            <input
                              type="number"
                              value={formData.totalEpisodes ?? item.totalEpisodes ?? ""}
                              onChange={(event) => handleChange("totalEpisodes", event.target.value)}
                              placeholder="?"
                              className="surface-input theme-focus-accent w-20 rounded-xl px-2 py-1.5 text-center text-sm text-white transition"
                            />
                          </div>
                        ) : (
                          <>
                            <span className="text-2xl text-white">{displayProgress}</span>
                            <span className="mx-1 text-zinc-500">/</span>
                            <span>{displayTotalEpisodes || "?"}</span>
                            <span className="ml-1 text-xs text-zinc-500">EP</span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-900/90">
                      <div
                        className="theme-spectrum-gradient h-full rounded-full transition-all duration-700"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">首播</div>
                        <div className="mt-2 text-sm text-zinc-100">{formatDateLabel(item.premiereDate)}</div>
                      </div>
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">单集时长</div>
                        <div className="mt-2 text-sm text-zinc-100">{displayDuration ? `${displayDuration} min` : "未知"}</div>
                      </div>
                      <div className="surface-card-muted rounded-2xl p-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">片源状态</div>
                        <div className={`mt-2 text-sm font-medium ${displayIsFinished ? "theme-accent-text" : "theme-secondary-text"}`}>
                          {displayIsFinished ? "已完结" : "连载中"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <SparklesIcon className="h-4 w-4" />
                      简介 / 剧情
                    </div>
                    {canEdit ? (
                      <textarea
                        rows={8}
                        value={formData.summary || ""}
                        onChange={(event) => handleChange("summary", event.target.value)}
                        className="surface-input theme-focus-accent mt-4 min-h-[220px] w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : (
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-8 text-zinc-300">
                        {item.summary || "暂无简介"}
                      </p>
                    )}
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <ClockIcon className="h-4 w-4" />
                      个人备注
                    </div>
                    {canEdit ? (
                      <textarea
                        rows={4}
                        value={formData.notes || ""}
                        onChange={(event) => handleChange("notes", event.target.value)}
                        className="surface-input theme-focus-accent mt-4 w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : (
                      <p className="mt-4 text-sm italic leading-7 text-zinc-400">
                        {item.notes || "还没有留下观后感。"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                      <CalendarIcon className="h-4 w-4" />
                      时间轴
                    </div>

                    <div className="mt-4 space-y-3 text-sm">
                      <div
                        className={`surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3 ${canEdit ? "cursor-pointer" : ""}`}
                        onClick={canEdit ? () => openDatePicker(startDateInputRef.current) : undefined}
                      >
                        <span className="text-zinc-500">开始观看</span>
                        {canEdit ? (
                          <input
                            ref={startDateInputRef}
                            type="date"
                            value={formData.startDate || ""}
                            onChange={(event) => handleChange("startDate", event.target.value)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openDatePicker(startDateInputRef.current);
                            }}
                            onFocus={() => openDatePicker(startDateInputRef.current)}
                            className="surface-input theme-focus-accent w-[172px] rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.startDate)}</span>
                        )}
                      </div>

                      <div
                        className={`surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3 ${canEdit ? "cursor-pointer" : ""}`}
                        onClick={canEdit ? () => openDatePicker(endDateInputRef.current) : undefined}
                      >
                        <span className="text-zinc-500">看完日期</span>
                        {canEdit ? (
                          <input
                            ref={endDateInputRef}
                            type="date"
                            value={formData.endDate || ""}
                            onChange={(event) => handleChange("endDate", event.target.value)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openDatePicker(endDateInputRef.current);
                            }}
                            onFocus={() => openDatePicker(endDateInputRef.current)}
                            className="surface-input theme-focus-accent w-[172px] rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.endDate)}</span>
                        )}
                      </div>

                      <div
                        className={`surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3 ${canEdit ? "cursor-pointer" : ""}`}
                        onClick={canEdit ? () => openDatePicker(premiereDateInputRef.current) : undefined}
                      >
                        <span className="text-zinc-500">首播日期</span>
                        {canEdit ? (
                          <input
                            ref={premiereDateInputRef}
                            type="date"
                            value={formData.premiereDate || ""}
                            onChange={(event) => handleChange("premiereDate", event.target.value)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openDatePicker(premiereDateInputRef.current);
                            }}
                            onFocus={() => openDatePicker(premiereDateInputRef.current)}
                            className="surface-input theme-focus-accent w-[172px] rounded-xl px-2 py-1.5 text-sm text-white transition"
                          />
                        ) : (
                          <span className="text-zinc-100">{formatDateLabel(item.premiereDate)}</span>
                        )}
                      </div>

                      <div className="surface-card-muted flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
                        <span className="text-zinc-500">放送状态</span>
                        {canEdit ? (
                          <label className="flex items-center gap-2 text-sm text-zinc-200">
                            <input
                              type="checkbox"
                              checked={Boolean(formData.isFinished ?? item.isFinished)}
                              onChange={(event) => handleChange("isFinished", event.target.checked)}
                              className="h-4 w-4 rounded border-white/10 bg-zinc-950 text-primary focus:ring-primary"
                            />
                            已完结
                          </label>
                        ) : (
                          <span className={displayIsFinished ? "theme-accent-text" : "theme-secondary-text"}>{displayIsFinished ? "已完结" : "连载中"}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="surface-card rounded-[24px] p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
                        <SparklesIcon className="h-4 w-4" />
                        声优阵容
                      </div>
                      {!canEdit && item.cast && item.cast.length > 0 && (
                        <span className="text-xs text-zinc-500">{item.cast.length} 名</span>
                      )}
                    </div>

                    {canEdit ? (
                      <textarea
                        rows={5}
                        value={Array.isArray(formData.cast) ? formData.cast.join(", ") : (formData.cast || "")}
                        placeholder="花泽香菜, 宫野真守 (逗号分隔)"
                        onChange={(event) => {
                          handleChange("cast", event.target.value.split(/[,，]/).map((name) => name.trim()).filter(Boolean));
                        }}
                        className="surface-input theme-focus-accent mt-4 w-full rounded-2xl p-4 text-sm leading-7 text-zinc-200 transition"
                      />
                    ) : item.cast && item.cast.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.cast.map((cv, index) => (
                          <Link
                            key={`${cv}-${index}`}
                            to={`/anime?cast=${encodeURIComponent(cv)}`}
                            className="theme-secondary-soft rounded-full px-3 py-1.5 text-xs transition"
                          >
                            {cv}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-zinc-500">还没有补到声优信息。</p>
                    )}
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/5 p-5 backdrop-blur-xl">
                  <button onClick={deleteAnime} className="flex items-center gap-2 text-sm text-rose-300 transition hover:text-rose-200">
                    <TrashIcon className="h-4 w-4" />
                    删除此番剧
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除番剧"
        message={`确定要删除「${item.title}」吗？删除后其观看历史也会一并清除，无法恢复。`}
        confirmText="确认删除"
        cancelText="再想想"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}