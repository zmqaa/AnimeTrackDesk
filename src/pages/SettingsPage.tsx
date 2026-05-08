import { useTheme } from "@/components/theme/ThemeProvider";
import { formatLocalDateTimeString } from "@/lib/local-date-time";
import type { AppTheme } from "@/lib/theme";
import { readRuntimeInfo, type RuntimeInfo } from "@/src/lib/runtime";
import {
  getCachedSettings,
  getDefaultSettings,
  loadSettings,
  saveSettings,
  testAiConnection,
  validateAiSettings,
  type AiConnectionTestResult,
  type AiProviderSettings,
  type AppSettings,
} from "@/src/lib/settings-store";
import { BoltIcon, CheckCircleIcon, CircleStackIcon, PencilSquareIcon, XCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

type AiProviderPreset = {
  label: string;
  provider: string;
  baseUrl: string;
  defaultModel: string;
};

type AiConnectionState = {
  status: "idle" | "testing" | "connected" | "failed";
  message: string;
  result: AiConnectionTestResult | null;
};

type ThemeOption = {
  value: AppTheme;
  label: string;
  description: string;
  preview: string;
};

const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    label: "OpenAI",
    provider: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
  },
  {
    label: "DeepSeek",
    provider: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    label: "OpenRouter",
    provider: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
  },
  {
    label: "Qwen",
    provider: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  {
    label: "GLM",
    provider: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
  },
];

function formatDateTime(value: string | null) {
  return formatLocalDateTimeString(value, "尚未保存");
}

function describeStorageMode(runtimeInfo: RuntimeInfo | null) {
  if (!runtimeInfo) {
    return "浏览器预览 / 本地缓存";
  }

  if (runtimeInfo.storageMode === "sqlite-bootstrap") {
    return `SQLite 已就绪${runtimeInfo.schemaVersion != null ? ` · schema v${runtimeInfo.schemaVersion}` : ""}`;
  }

  return runtimeInfo.storageMode;
}

function describeStorageLocation(runtimeInfo: RuntimeInfo | null) {
  if (!runtimeInfo?.databasePath) {
    return "桌面端会统一使用系统应用数据目录。";
  }

  const normalizedPath = runtimeInfo.databasePath.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").filter(Boolean).pop() || "animetrack.db";
  return `系统应用数据目录 · ${fileName}`;
}

function getThemeLabel(themes: readonly ThemeOption[], value: AppTheme) {
  return themes.find((option) => option.value === value)?.label ?? "当前主题";
}

function areAiSettingsEqual(left: AiProviderSettings, right: AiProviderSettings) {
  return left.enabled === right.enabled
    && left.provider === right.provider
    && left.baseUrl === right.baseUrl
    && left.model === right.model
    && left.apiKey === right.apiKey;
}

function getInitialAiConnectionState(ai: AiProviderSettings): AiConnectionState {
  if (!ai.enabled) {
    return {
      status: "idle",
      message: "AI 未启用，本地记录、浏览和导出不受影响。",
      result: null,
    };
  }

  return {
    status: "idle",
    message: "AI 已启用；建议测试并保存后再使用快速录入。",
    result: null,
  };
}

function getAiStatusLabel(ai: AiProviderSettings, connectionState: AiConnectionState) {
  if (connectionState.status === "testing") {
    return "测试中";
  }

  if (connectionState.status === "connected") {
    return "已连接";
  }

  if (connectionState.status === "failed") {
    return "连接失败";
  }

  if (!ai.enabled) {
    return "未启用";
  }

  return "待测试";
}

function buildInitialSettings(theme: AppTheme): AppSettings {
  return getCachedSettings({
    ...getDefaultSettings(),
    theme,
  });
}

export default function SettingsPage() {
  const { theme, setTheme, themes } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(() => buildInitialSettings(theme));
  const [aiDraft, setAiDraft] = useState<AiProviderSettings>(() => buildInitialSettings(theme).ai);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [isAiEditorOpen, setIsAiEditorOpen] = useState(false);
  const [aiConnectionState, setAiConnectionState] = useState<AiConnectionState>(() => getInitialAiConnectionState(buildInitialSettings(theme).ai));
  const hasLoadedSettingsRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    void readRuntimeInfo()
      .then((value) => {
        if (mounted) {
          setRuntimeInfo(value);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingRuntime(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (hasLoadedSettingsRef.current) {
      return;
    }

    hasLoadedSettingsRef.current = true;
    let mounted = true;
    const fallbackSettings = buildInitialSettings(theme);

    void loadSettings(fallbackSettings).then((value) => {
      if (!mounted) {
        return;
      }

      setSettings(value);
      setAiDraft(value.ai);
      setAiConnectionState(getInitialAiConnectionState(value.ai));
      if (value.theme !== theme) {
        setTheme(value.theme);
      }
    });

    return () => {
      mounted = false;
    };
  }, [setTheme, theme]);

  useEffect(() => {
    setSettings((current) => {
      if (current.theme === theme) {
        return current;
      }

      return {
        ...current,
        theme,
      };
    });
  }, [theme]);

  const persistSettings = useCallback(async (nextValue: AppSettings, successMessage: string) => {
    setIsSaving(true);

    try {
      const nextSettings = await saveSettings(nextValue);
      setSettings(nextSettings);
      setAiDraft(nextSettings.ai);
      if (nextSettings.theme !== theme) {
        setTheme(nextSettings.theme);
      }

      toast.success(successMessage);
      return nextSettings;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存设置失败");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [setTheme, theme]);

  const handleValidateAi = useCallback(async () => {
    if (!aiDraft.enabled) {
      const message = "请先启用 AI，再测试连接。";
      setAiConnectionState({ status: "failed", message, result: null });
      toast.error(message);
      return;
    }

    const validationResult = validateAiSettings(aiDraft);
    setAiConnectionState({ status: validationResult.ok ? "idle" : "failed", message: validationResult.message, result: null });

    if (!validationResult.ok) {
      toast.error(validationResult.message);
      return;
    }

    setIsTestingAi(true);
    setAiConnectionState({ status: "testing", message: "正在发起最小联网请求...", result: null });

    try {
      const result: AiConnectionTestResult = await testAiConnection(aiDraft);

      if (result.ok) {
        const persistedSettings = await persistSettings({
          ...settings,
          ai: aiDraft,
        }, "AI 配置已测试通过并保存");

        if (persistedSettings) {
          const message = `${result.message} 已保存，可用于 AI 快速录入。`;
          setAiConnectionState({ status: "connected", message, result });
          setIsAiEditorOpen(false);
        }

        return;
      }

      setAiConnectionState({ status: "failed", message: result.message, result });
      toast.error(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 连接测试失败";
      setAiConnectionState({ status: "failed", message, result: null });
      toast.error(message);
    } finally {
      setIsTestingAi(false);
    }
  }, [aiDraft, saveSettings, settings]);

  const handleSaveAiDraft = useCallback(async () => {
    const validationResult = validateAiSettings(aiDraft, { allowDisabled: true });
    if (!validationResult.ok) {
      setAiConnectionState({ status: "failed", message: validationResult.message, result: null });
      toast.error(validationResult.message);
      return;
    }

    const persistedSettings = await persistSettings({
      ...settings,
      ai: aiDraft,
    }, aiDraft.enabled ? "AI 配置已保存" : "AI 已关闭");

    if (persistedSettings) {
      setAiConnectionState(getInitialAiConnectionState(persistedSettings.ai));
      setIsAiEditorOpen(false);
    }
  }, [aiDraft, saveSettings, settings]);

  const handleThemeSelect = useCallback((nextTheme: AppTheme) => {
    setTheme(nextTheme);

    const nextSettings = {
      ...settings,
      theme: nextTheme,
    };
    setSettings(nextSettings);
    void persistSettings(nextSettings, "主题已保存");
  }, [persistSettings, setTheme, settings]);

  const handleOpenAiEditor = useCallback(() => {
    setAiDraft(settings.ai);
    setIsAiEditorOpen(true);
  }, [settings.ai]);

  const handleCloseAiEditor = useCallback(() => {
    setAiDraft(settings.ai);
    setIsAiEditorOpen(false);
  }, [settings.ai]);

  const updateAiDraft = useCallback((updater: (current: AiProviderSettings) => AiProviderSettings) => {
    setAiDraft((current) => updater(current));
  }, []);

  const applyAiPreset = useCallback((preset: AiProviderPreset) => {
    updateAiDraft((current) => ({
      ...current,
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: current.model.trim() ? current.model : preset.defaultModel,
    }));
  }, [updateAiDraft]);

  const isRuntimeReady = !loadingRuntime && runtimeInfo !== null;
  const aiStatusLabel = getAiStatusLabel(settings.ai, aiConnectionState);
  const hasAiDraftChanges = useMemo(() => !areAiSettingsEqual(aiDraft, settings.ai), [aiDraft, settings.ai]);
  const selectedThemeLabel = getThemeLabel(themes, settings.theme);
  const isAiActionDisabled = isSaving || isTestingAi;

  return (
    <main className="p-4 md:p-8 space-y-8 pb-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display tracking-tight text-zinc-100">设置</h1>
          <p className="mt-2 max-w-3xl text-base leading-7 text-zinc-500">调整主题与可选 AI 配置。番剧数据保存在本机数据库，API Key 优先写入系统安全存储。</p>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="glass-panel rounded-3xl border border-white/5 p-5 md:p-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.26em] text-zinc-500">
            <CircleStackIcon className="h-4 w-4" />
            本地数据库
          </div>
          <div className="mt-3 text-lg font-semibold text-zinc-100">{loadingRuntime ? "读取中..." : describeStorageMode(runtimeInfo)}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{describeStorageLocation(runtimeInfo)}</p>
          {isRuntimeReady && runtimeInfo?.databasePath && (
            <details className="mt-3 text-xs text-zinc-500">
              <summary className="cursor-pointer select-none text-zinc-400 transition hover:text-zinc-200">查看实际路径</summary>
              <code className="mt-2 block break-all rounded-2xl border border-white/10 bg-black/20 p-3 leading-5 text-zinc-400">{runtimeInfo.databasePath}</code>
            </details>
          )}
        </div>

        <div className="glass-panel rounded-3xl border border-white/5 p-5 md:p-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.26em] text-zinc-500">
            {aiConnectionState.status === "connected" ? <CheckCircleIcon className="h-4 w-4" /> : <BoltIcon className="h-4 w-4" />}
            AI 状态
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${aiConnectionState.status === "connected" ? "bg-emerald-400/12 text-emerald-200" : aiConnectionState.status === "failed" ? "bg-rose-400/12 text-rose-200" : "bg-white/[0.06] text-zinc-200"}`}>{aiStatusLabel}</span>
            {settings.ai.enabled && <span className="min-w-0 truncate text-sm text-zinc-500">{settings.ai.provider} · {settings.ai.model}</span>}
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-500">{aiConnectionState.message}</p>
        </div>

        <div className="glass-panel rounded-3xl border border-white/5 p-5 md:p-6">
          <div className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">当前偏好</div>
          <div className="mt-3 text-lg font-semibold text-zinc-100">{selectedThemeLabel}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-500">最近保存：{formatDateTime(settings.updatedAt)}</p>
        </div>
      </section>

      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8 space-y-5">
        <div>
          <h2 className="text-lg font-medium text-zinc-200">主题外观</h2>
          <p className="text-sm text-zinc-500 mt-2">主题切换会立即生效并自动保存。</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {themes.map((option) => {
            const isSelected = settings.theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleThemeSelect(option.value)}
                className={`rounded-[24px] border px-4 py-4 text-left transition-all ${isSelected ? "theme-accent-soft border-white/20 shadow-[0_18px_36px_var(--accent-shadow)]" : "border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.03]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: option.preview,
                        boxShadow: `0 0 16px ${option.preview}66`,
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{option.label}</div>
                      <div className="mt-1 text-xs text-zinc-500">{option.description}</div>
                    </div>
                  </div>
                  {isSelected && <span className="text-[10px] uppercase tracking-[0.26em] theme-accent-text-muted">当前</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-medium text-zinc-200">AI 配置</h2>
            <p className="text-sm text-zinc-500 mt-2">AI 是可选增强项。未配置时，记录、浏览和导出仍然完整可用。</p>
          </div>
          <button
            type="button"
            onClick={handleOpenAiEditor}
            className="surface-pill inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.08]"
          >
            <PencilSquareIcon className="h-4 w-4" />
            修改
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">开关</div>
            <div className="mt-2 text-base font-medium text-zinc-100">{settings.ai.enabled ? "已启用" : "未启用"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Provider</div>
            <div className="mt-2 truncate text-base font-medium text-zinc-100">{settings.ai.enabled ? settings.ai.provider : "未配置"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">模型</div>
            <div className="mt-2 truncate text-base font-medium text-zinc-100">{settings.ai.enabled ? settings.ai.model : "未配置"}</div>
          </div>
        </div>
      </section>

      {isAiEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <section className="glass-panel max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 p-5 shadow-2xl md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-100">修改 AI 配置</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">选择常用厂商预设，或填写任何兼容 OpenAI Chat Completions 的服务地址。</p>
              </div>
              <button
                type="button"
                onClick={handleCloseAiEditor}
                className="surface-pill inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/[0.08]"
                aria-label="关闭 AI 配置"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {AI_PROVIDER_PRESETS.map((preset) => {
                const isSelected = aiDraft.provider === preset.provider && aiDraft.baseUrl === preset.baseUrl;

                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyAiPreset(preset)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${isSelected ? "theme-accent-soft border-white/20 text-zinc-100" : "surface-pill text-zinc-300 hover:bg-white/[0.08]"}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 flex items-center justify-between gap-4 lg:col-span-2">
                <div>
                  <div className="text-sm text-zinc-200">启用 AI</div>
                  <div className="text-xs leading-5 text-zinc-500 mt-1">关闭后不会影响番剧列表、详情、时间线、备份和管理页的本地基础功能。</div>
                </div>
                <button
                  type="button"
                  onClick={() => updateAiDraft((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))}
                  className={`relative h-7 w-12 rounded-full transition-colors ${aiDraft.enabled ? "bg-emerald-500/80" : "bg-zinc-700"}`}
                  aria-pressed={aiDraft.enabled}
                >
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${aiDraft.enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">AI 厂商</span>
                <input
                  value={aiDraft.provider}
                  onChange={(event) => updateAiDraft((current) => ({
                    ...current,
                    provider: event.target.value,
                  }))}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-white/20"
                  placeholder="例如：OpenAI Compatible"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">模型名</span>
                <input
                  value={aiDraft.model}
                  onChange={(event) => updateAiDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-white/20"
                  placeholder="例如：gpt-4.1-mini"
                />
              </label>

              <label className="space-y-2 lg:col-span-2">
                <span className="text-sm text-zinc-300">Base URL</span>
                <input
                  value={aiDraft.baseUrl}
                  onChange={(event) => updateAiDraft((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-white/20"
                  placeholder="https://api.openai.com/v1"
                />
              </label>

              <label className="space-y-2 lg:col-span-2">
                <span className="text-sm text-zinc-300">API Key</span>
                <input
                  type="password"
                  value={aiDraft.apiKey}
                  onChange={(event) => updateAiDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-white/20"
                  placeholder="桌面端会优先写入系统安全存储"
                />
              </label>

              <div className="rounded-[24px] border border-amber-300/10 bg-amber-400/10 p-4 text-sm leading-6 text-amber-50/90 lg:col-span-2">
                API Key 会优先写入系统安全存储，不保存在 SQLite 字段中。测试连接成功后，这份草稿会自动保存并立即供 AI 快速录入使用。
              </div>

              {aiConnectionState.message && (
                <div className={`flex gap-3 rounded-[24px] border p-4 text-sm leading-6 lg:col-span-2 ${aiConnectionState.status === "connected" ? "border-emerald-300/15 bg-emerald-400/10 text-emerald-50/90" : aiConnectionState.status === "failed" ? "border-rose-300/15 bg-rose-400/10 text-rose-50/90" : "border-white/10 bg-white/[0.04] text-zinc-300"}`}>
                  {aiConnectionState.status === "failed" ? <XCircleIcon className="mt-0.5 h-5 w-5 flex-none" /> : <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />}
                  <span>{aiConnectionState.message}</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseAiEditor}
                className="surface-pill rounded-full px-5 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.08]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveAiDraft}
                disabled={isAiActionDisabled || !hasAiDraftChanges}
                className="surface-pill rounded-full px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSaving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                onClick={handleValidateAi}
                disabled={isAiActionDisabled || !aiDraft.enabled}
                className="theme-accent-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCircleIcon className="h-4 w-4" />
                {isTestingAi ? "测试中..." : "测试并保存"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}