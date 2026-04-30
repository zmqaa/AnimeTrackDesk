import { DEFAULT_THEME, isAppTheme, type AppTheme } from "@/lib/theme";

export interface DesktopAiProviderSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface DesktopAppSettings {
  displayName: string;
  theme: AppTheme;
  ai: DesktopAiProviderSettings;
  updatedAt: string | null;
}

export interface DesktopAiValidationResult {
  ok: boolean;
  message: string;
}

export interface DesktopAiConnectionTestResult extends DesktopAiValidationResult {
  provider: string;
  endpoint: string | null;
  statusCode: number | null;
  latencyMs: number | null;
}

interface DesktopAiValidationOptions {
  allowDisabled?: boolean;
}

const SETTINGS_STORAGE_KEY = "animetrack.settings";

const DEFAULT_DESKTOP_SETTINGS: DesktopAppSettings = {
  displayName: "动漫记录",
  theme: DEFAULT_THEME,
  ai: {
    enabled: false,
    provider: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
  },
  updatedAt: null,
};

type DesktopSettingsCommand = "load_desktop_settings" | "save_desktop_settings" | "test_desktop_ai_connection";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAiSettings(value: unknown): DesktopAiProviderSettings {
  const record = isRecord(value) ? value : {};

  return {
    enabled: Boolean(record.enabled),
    provider: normalizeText(record.provider, DEFAULT_DESKTOP_SETTINGS.ai.provider),
    baseUrl: normalizeText(record.baseUrl, DEFAULT_DESKTOP_SETTINGS.ai.baseUrl).replace(/\/+$/, ""),
    model: normalizeText(record.model, DEFAULT_DESKTOP_SETTINGS.ai.model),
    apiKey: normalizeOptionalText(record.apiKey),
  };
}

function normalizeDesktopSettings(value: unknown): DesktopAppSettings {
  const record = isRecord(value) ? value : {};

  return {
    displayName: normalizeText(record.displayName, DEFAULT_DESKTOP_SETTINGS.displayName),
    theme: typeof record.theme === "string" && isAppTheme(record.theme) ? record.theme : DEFAULT_DESKTOP_SETTINGS.theme,
    ai: normalizeAiSettings(record.ai),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : null,
  };
}

function stripDesktopSettingsSecrets(value: DesktopAppSettings) {
  return normalizeDesktopSettings({
    ...value,
    ai: {
      ...value.ai,
      apiKey: "",
    },
  });
}

function mergeDesktopSettings(base: DesktopAppSettings, override?: Partial<DesktopAppSettings>) {
  if (!override) {
    return base;
  }

  const aiOverride = isRecord(override.ai) ? override.ai : {};

  return normalizeDesktopSettings({
    ...base,
    ...override,
    ai: {
      ...base.ai,
      ...aiOverride,
    },
  });
}

function hasPersistedCustomSettings(value: DesktopAppSettings) {
  return value.updatedAt !== null
    || value.displayName !== DEFAULT_DESKTOP_SETTINGS.displayName
    || value.theme !== DEFAULT_DESKTOP_SETTINGS.theme
    || value.ai.enabled !== DEFAULT_DESKTOP_SETTINGS.ai.enabled
    || value.ai.provider !== DEFAULT_DESKTOP_SETTINGS.ai.provider
    || value.ai.baseUrl !== DEFAULT_DESKTOP_SETTINGS.ai.baseUrl
    || value.ai.model !== DEFAULT_DESKTOP_SETTINGS.ai.model
    || value.ai.apiKey !== DEFAULT_DESKTOP_SETTINGS.ai.apiKey;
}

function readSettingsFromLocalStorage() {
  if (typeof window === "undefined") {
    return DEFAULT_DESKTOP_SETTINGS;
  }

  const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return DEFAULT_DESKTOP_SETTINGS;
  }

  try {
    return normalizeDesktopSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_DESKTOP_SETTINGS;
  }
}

function writeSettingsToLocalStorage(value: DesktopAppSettings) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  }
}

async function invokeDesktopSettingsCommand<T>(command: DesktopSettingsCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

async function persistDesktopSettingsToTauri(value: DesktopAppSettings) {
  const response = await invokeDesktopSettingsCommand<DesktopAppSettings>("save_desktop_settings", { settings: value });
  return response ? normalizeDesktopSettings(response) : null;
}

function normalizeAiConnectionTestResult(value: unknown, fallback: DesktopAiProviderSettings): DesktopAiConnectionTestResult {
  const record = isRecord(value) ? value : {};

  return {
    ok: Boolean(record.ok),
    message: normalizeText(record.message, "AI 连接测试失败。"),
    provider: normalizeText(record.provider, fallback.provider || "AI Provider"),
    endpoint: typeof record.endpoint === "string" && record.endpoint.trim() ? record.endpoint : null,
    statusCode: normalizeOptionalNumber(record.statusCode),
    latencyMs: normalizeOptionalNumber(record.latencyMs),
  };
}

export function getCachedDesktopSettings(fallback?: DesktopAppSettings) {
  return mergeDesktopSettings(readSettingsFromLocalStorage(), fallback);
}

export async function loadDesktopSettings(fallback?: DesktopAppSettings) {
  const cachedSettings = getCachedDesktopSettings(fallback);
  const response = await invokeDesktopSettingsCommand<DesktopAppSettings>("load_desktop_settings");

  if (!response) {
    writeSettingsToLocalStorage(cachedSettings);
    return cachedSettings;
  }

  const tauriSettings = normalizeDesktopSettings(response);
  if (!tauriSettings.ai.apiKey && cachedSettings.ai.apiKey) {
    const migratedSettings = await persistDesktopSettingsToTauri({
      ...tauriSettings,
      ai: {
        ...tauriSettings.ai,
        apiKey: cachedSettings.ai.apiKey,
      },
    });

    if (migratedSettings) {
      writeSettingsToLocalStorage(stripDesktopSettingsSecrets(migratedSettings));
      return migratedSettings;
    }
  }

  if (tauriSettings.updatedAt === null && hasPersistedCustomSettings(cachedSettings)) {
    const migratedSettings = await persistDesktopSettingsToTauri(cachedSettings);
    if (migratedSettings) {
      writeSettingsToLocalStorage(stripDesktopSettingsSecrets(migratedSettings));
      return migratedSettings;
    }

    writeSettingsToLocalStorage(cachedSettings);
    return cachedSettings;
  }

  writeSettingsToLocalStorage(stripDesktopSettingsSecrets(tauriSettings));
  return tauriSettings;
}

export async function saveDesktopSettings(value: DesktopAppSettings) {
  const nextSettings = normalizeDesktopSettings({
    ...value,
    updatedAt: new Date().toISOString(),
  });

  const persistedSettings = await persistDesktopSettingsToTauri(nextSettings);
  if (persistedSettings) {
    writeSettingsToLocalStorage(stripDesktopSettingsSecrets(persistedSettings));
    return persistedSettings;
  }

  writeSettingsToLocalStorage(nextSettings);
  return nextSettings;
}

export function getDefaultDesktopSettings() {
  return DEFAULT_DESKTOP_SETTINGS;
}

export function validateDesktopAiSettings(
  value: DesktopAiProviderSettings,
  options?: DesktopAiValidationOptions,
): DesktopAiValidationResult {
  if (!value.enabled && !options?.allowDisabled) {
    return {
      ok: true,
      message: "AI 当前未启用，基础记录功能仍可离线使用。",
    };
  }

  if (!value.enabled && options?.allowDisabled) {
    return {
      ok: true,
      message: "AI 当前未启用，但仍可测试当前草稿配置。",
    };
  }

  if (!value.provider.trim()) {
    return {
      ok: false,
      message: "请先填写 AI 厂商名称。",
    };
  }

  if (!value.baseUrl.trim()) {
    return {
      ok: false,
      message: "请先填写 Base URL。",
    };
  }

  try {
    const parsedUrl = new URL(value.baseUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return {
        ok: false,
        message: "Base URL 必须是 http 或 https 地址。",
      };
    }
  } catch {
    return {
      ok: false,
      message: "Base URL 格式无效。",
    };
  }

  if (!value.model.trim()) {
    return {
      ok: false,
      message: "请先填写模型名。",
    };
  }

  if (!value.apiKey.trim()) {
    return {
      ok: false,
      message: "请先填写 API Key。",
    };
  }

  return {
    ok: true,
    message: "已完成本地字段校验，可以继续发起桌面端联网测试。",
  };
}

export async function testDesktopAiConnection(value: DesktopAiProviderSettings): Promise<DesktopAiConnectionTestResult> {
  const normalizedSettings = normalizeAiSettings(value);
  const response = await invokeDesktopSettingsCommand<DesktopAiConnectionTestResult>("test_desktop_ai_connection", {
    settings: normalizedSettings,
  });

  if (!response) {
    return {
      ok: false,
      message: "当前环境没有可用的 Tauri 桌面命令层，请在桌面运行时测试 AI 配置。",
      provider: normalizedSettings.provider,
      endpoint: null,
      statusCode: null,
      latencyMs: null,
    };
  }

  return normalizeAiConnectionTestResult(response, normalizedSettings);
}