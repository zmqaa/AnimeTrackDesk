import SidebarLayout from "@/components/SidebarLayout";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import Toast from "@/components/shared/Toast";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { hydrateAnimeStore } from "@/src/lib/anime-store";
import { Suspense, lazy, type ReactNode, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

const Dashboard = lazy(() => import("@/components/Dashboard"));
const AnimeAtlasPage = lazy(() => import("@/app/anime/atlas/page"));
const AnimeSeasonsPage = lazy(() => import("@/app/anime/seasons/page"));
const AdminPage = lazy(() => import("@/src/pages/AdminPage"));
const AnimeDetailPage = lazy(() => import("@/src/pages/AnimeDetailPage"));
const BackupPage = lazy(() => import("@/src/pages/BackupPage"));
const AnimePage = lazy(() => import("@/src/pages/AnimePage"));
const AnimeRecommendationsPage = lazy(() => import("@/src/pages/AnimeRecommendationsPage"));
const SettingsPage = lazy(() => import("@/src/pages/SettingsPage"));
const AnimeTimelinePage = lazy(() => import("@/src/pages/AnimeTimelinePage"));

function AppDataBootstrap({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    void hydrateAnimeStore()
      .catch(() => null)
      .finally(() => {
        if (mounted) {
          setIsReady(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (isReady) {
    return <>{children}</>;
  }

  return (
    <div className="p-4 lg:p-8 pb-20">
      <section className="glass-panel-strong rounded-[32px] p-8 lg:p-10 space-y-5 max-w-4xl">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Local Repository</p>
          <h1 className="text-3xl font-display text-zinc-100 tracking-tight">正在连接本地番剧仓储</h1>
          <p className="text-zinc-400 leading-7 max-w-2xl">
            当前会优先从 Tauri SQLite 载入番剧、历史和缓存快照；如果当前环境还没有本地命令层，就会自动回退到本地缓存继续渲染。
          </p>
        </div>

        <div className="surface-card rounded-[24px] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 animate-pulse" />
            <div className="text-lg text-zinc-100 font-medium">正在同步本地数据快照...</div>
          </div>
          <div className="text-sm text-zinc-400">首次进入时会把当前桌面缓存与 SQLite 快照对齐，之后页面继续沿用原来的同步控制层。</div>
        </div>
      </section>
    </div>
  );
}

function MigrationPlaceholder() {
  const location = useLocation();

  return (
    <div className="p-4 lg:p-8 pb-20">
      <section className="glass-panel-strong rounded-[32px] p-8 lg:p-10 space-y-5 max-w-4xl">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Migration Route</p>
          <h1 className="text-3xl font-display text-zinc-100 tracking-tight">这个页面正在按原项目界面迁移</h1>
          <p className="text-zinc-400 leading-7 max-w-2xl">
            当前总览、番剧列表、详情、时间轴、分析页、设置页、备份页和管理页都已经接入当前应用。这个路由后续会继续沿用原有信息架构和视觉语言，只是底层能力会逐步切到本地 SQLite 和 Tauri。
          </p>
        </div>

        <div className="surface-card rounded-[24px] p-5 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Current Route</div>
          <div className="text-lg text-zinc-100 font-mono">{location.pathname}</div>
          <div className="text-sm text-zinc-400">下一步重点会转向本地持久化、Tauri 命令层和剩余零散交互补齐。</div>
        </div>
      </section>
    </div>
  );
}

function RoutePendingState() {
  return (
    <div className="p-4 lg:p-8 pb-20">
      <section className="glass-panel-strong rounded-[32px] p-8 lg:p-10 space-y-5 max-w-4xl">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Route Module</p>
          <h1 className="text-3xl font-display text-zinc-100 tracking-tight">正在加载页面模块</h1>
          <p className="text-zinc-400 leading-7 max-w-2xl">
            主路由现在按页面拆分加载，避免首页把图表、管理页、备份页和详情页全部打进首屏入口。
          </p>
        </div>

        <div className="surface-card rounded-[24px] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-300 animate-pulse" />
            <div className="text-lg text-zinc-100 font-medium">正在按需装载当前页面资源...</div>
          </div>
          <div className="text-sm text-zinc-400">这样首屏只保留导航和必要框架代码，其他页面在进入时再加载。</div>
        </div>
      </section>
    </div>
  );
}

function AppRoutes() {
  return (
    <SidebarLayout>
      <ErrorBoundary>
        <Suspense fallback={<RoutePendingState />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/anime" element={<AnimePage />} />
            <Route path="/anime/:id" element={<AnimeDetailPage />} />
            <Route path="/anime/recommendations" element={<AnimeRecommendationsPage />} />
            <Route path="/anime/atlas" element={<AnimeAtlasPage />} />
            <Route path="/anime/seasons" element={<AnimeSeasonsPage />} />
            <Route path="/anime/timeline" element={<AnimeTimelinePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
            <Route path="*" element={<MigrationPlaceholder />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </SidebarLayout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <Toast />
        <AppDataBootstrap>
          <AppRoutes />
        </AppDataBootstrap>
      </ThemeProvider>
    </HashRouter>
  );
}