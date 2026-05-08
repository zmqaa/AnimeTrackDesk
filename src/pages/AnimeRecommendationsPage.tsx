import { addAnimeRecommendationToLibrary, loadAnimeRecommendations, type RecommendationItem, type RecommendationSnapshot } from "@/src/lib/anime-recommendations";
import { ArrowPathIcon, ClockIcon, PlusCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

const INITIAL_SNAPSHOT: RecommendationSnapshot = {
  generatedAt: "",
  batchIndex: 0,
  staleMutationCount: 0,
  profile: {
    topTags: [],
    topCast: [],
    recentKeywords: [],
  },
  items: [],
  totalPoolCount: 0,
  usedCache: false,
  autoRefreshThreshold: 10,
};

function formatDateTime(value: string) {
  if (!value) {
    return "尚未生成";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatPremiereDate(value?: string) {
  if (!value) {
    return "档期待补";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function RecommendationCard({ item, onAdd }: { item: RecommendationItem; onAdd: (item: RecommendationItem) => void }) {
  return (
    <article className="surface-card-muted rounded-[26px] border border-white/6 overflow-hidden flex flex-col lg:flex-row min-h-[260px]">
      <div className="w-full lg:w-[220px] shrink-0 bg-zinc-900/70 relative">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full min-h-[260px] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),transparent_55%),linear-gradient(180deg,rgba(24,24,27,0.9),rgba(9,9,11,0.95))] text-zinc-500 text-sm tracking-[0.3em] uppercase">
            No Cover
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute left-4 bottom-4 right-4 flex items-center gap-2 flex-wrap">
          <span className="surface-pill px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.22em] text-zinc-200">匹配度 {item.matchScore.toFixed(1)}</span>
          {item.score ? <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] text-emerald-200">Bangumi {item.score.toFixed(1)}</span> : null}
        </div>
      </div>

      <div className="flex-1 p-5 lg:p-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">推荐线索 {item.sourceQuery}</div>
            <div>
              <h2 className="text-2xl font-display tracking-tight text-zinc-100">{item.title}</h2>
              {item.originalTitle ? <p className="text-sm text-zinc-500 truncate">{item.originalTitle}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
              <span className="surface-pill px-2.5 py-1 rounded-full">{formatPremiereDate(item.premiereDate)}</span>
              {item.totalEpisodes ? <span className="surface-pill px-2.5 py-1 rounded-full">{item.totalEpisodes} 话</span> : null}
              {item.durationMinutes ? <span className="surface-pill px-2.5 py-1 rounded-full">{item.durationMinutes} 分钟</span> : null}
              <span className="surface-pill px-2.5 py-1 rounded-full">{item.isFinished === false ? "未完结" : "已完结或未知"}</span>
            </div>
          </div>

          <button
            onClick={() => onAdd(item)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200"
          >
            <PlusCircleIcon className="h-5 w-5" />
            加入片库
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">推荐理由</div>
            <div className="flex flex-wrap gap-2">
              {item.reasons.map((reason) => (
                <span key={reason} className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100">
                  {reason}
                </span>
              ))}
            </div>
            <p className="text-sm leading-7 text-zinc-300 line-clamp-4">{item.description || "Bangumi 暂无更完整的摘要，这条推荐主要基于你最近的标签、评分和观看记录聚合出来。"}</p>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">标签画像</div>
            <div className="flex flex-wrap gap-2">
              {item.tags.length > 0 ? item.tags.slice(0, 8).map((tag) => (
                <span key={tag} className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300">
                  {tag}
                </span>
              )) : <span className="text-sm text-zinc-500">Bangumi 标签暂缺</span>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function AnimeRecommendationsPage() {
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"next-batch" | "refresh" | null>(null);

  const load = async (mode: "default" | "next-batch" | "refresh") => {
    if (mode === "default") {
      setLoading(true);
    } else {
      setActionLoading(mode);
    }

    try {
      const nextSnapshot = await loadAnimeRecommendations(mode);
      setSnapshot(nextSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "推荐生成失败";
      toast.error(message);
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  useEffect(() => {
    void load("default");
  }, []);

  const profileTags = useMemo(() => snapshot.profile.topTags.slice(0, 6), [snapshot.profile.topTags]);
  const profileCast = useMemo(() => snapshot.profile.topCast.slice(0, 4), [snapshot.profile.topCast]);

  const handleAdd = (item: RecommendationItem) => {
    addAnimeRecommendationToLibrary(item);
    toast.success(`已将 ${item.title} 加入片库`);
    void load("default");
  };

  return (
    <div className="p-4 lg:p-8 pb-20 space-y-6">
      <section className="glass-panel-strong rounded-[32px] p-6 lg:p-8 space-y-6 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(74,222,128,0.14),transparent_30%),radial-gradient(circle_at_left,rgba(56,189,248,0.12),transparent_28%)] pointer-events-none" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-emerald-100">
              <SparklesIcon className="h-4 w-4" />
              推荐发现
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl lg:text-4xl font-display tracking-tight text-zinc-100">按你的片库口味找下一批想看番剧</h1>
              <p className="text-zinc-400 leading-7 max-w-2xl">
                这一页不会实时乱算，而是根据你当前片库的标签、评分、近期观看和常见声优聚合出偏好，再从 Bangumi 拉一批没出现在库里的候选并缓存下来。
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
            <button
              onClick={() => void load("next-batch")}
              disabled={loading || actionLoading !== null || snapshot.totalPoolCount === 0}
              className="surface-card rounded-[24px] border border-white/6 px-5 py-4 text-left transition hover:border-white/12 disabled:opacity-50"
            >
              <div className="flex items-center gap-2 text-zinc-100 font-medium"><ArrowPathIcon className="h-5 w-5" /> 换一批</div>
              <div className="mt-1 text-sm text-zinc-500">在当前候选池里切到下一组 20 部。</div>
            </button>

            <button
              onClick={() => void load("refresh")}
              disabled={loading || actionLoading !== null}
              className="surface-card rounded-[24px] border border-white/6 px-5 py-4 text-left transition hover:border-white/12 disabled:opacity-50"
            >
              <div className="flex items-center gap-2 text-zinc-100 font-medium"><ClockIcon className="h-5 w-5" /> 重新生成</div>
              <div className="mt-1 text-sm text-zinc-500">忽略当前缓存，按最新片库重算候选。</div>
            </button>
          </div>
        </div>

        <div className="relative grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="surface-card rounded-[24px] p-5 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">当前缓存状态</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-2xl font-display text-zinc-100">{snapshot.totalPoolCount}</div>
                <div className="text-xs text-zinc-500">候选池条目</div>
              </div>
              <div>
                <div className="text-2xl font-display text-zinc-100">{snapshot.staleMutationCount}/{snapshot.autoRefreshThreshold}</div>
                <div className="text-xs text-zinc-500">缓存后累计改动</div>
              </div>
              <div>
                <div className="text-2xl font-display text-zinc-100">{formatDateTime(snapshot.generatedAt)}</div>
                <div className="text-xs text-zinc-500">上次生成时间</div>
              </div>
            </div>
            <p className="text-sm text-zinc-500">
              {snapshot.usedCache ? "当前在复用缓存候选池。" : "当前是刚生成的新候选池。"}
              当累计改动达到阈值时，会自动触发下一次重算。
            </p>
          </div>

          <div className="surface-card rounded-[24px] p-5 space-y-4">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">偏好摘要</div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-zinc-500 mb-2">高权重标签</div>
                <div className="flex flex-wrap gap-2">
                  {profileTags.length > 0 ? profileTags.map((tag) => (
                    <span key={tag.label} className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100">
                      {tag.label} · {tag.weight.toFixed(1)}
                    </span>
                  )) : <span className="text-sm text-zinc-500">片库标签还不够多，推荐会更偏保守。</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-2">常见声优</div>
                <div className="flex flex-wrap gap-2">
                  {profileCast.length > 0 ? profileCast.map((cast) => (
                    <span key={cast.label} className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100">
                      {cast.label}
                    </span>
                  )) : <span className="text-sm text-zinc-500">现有片库声优信息还不足，当前主要按标签聚合。</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="surface-card rounded-[28px] p-8 text-zinc-400">正在整理候选池与偏好画像...</section>
      ) : snapshot.items.length === 0 ? (
        <section className="surface-card rounded-[28px] p-8 space-y-3 text-zinc-400">
          <div className="text-xl text-zinc-100">当前还没凑出足够合适的推荐候选</div>
          <p>通常是因为片库里标签和声优信息还比较稀疏，或者当前候选已经都被加入过片库。你可以先丰富一些条目，再点“重新生成”。</p>
        </section>
      ) : (
        <section className="space-y-4">
          {snapshot.items.map((item) => (
            <RecommendationCard key={item.id} item={item} onAdd={handleAdd} />
          ))}
        </section>
      )}
    </div>
  );
}