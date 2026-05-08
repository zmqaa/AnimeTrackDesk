import { DEFAULT_THEME, isAppTheme, type AppTheme } from "@/lib/theme";

export interface AiProviderSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AppSettings {
  displayName: string;
  theme: AppTheme;
  ai: AiProviderSettings;
  updatedAt: string | null;
}

export interface AiValidationResult {
  ok: boolean;
  message: string;
}

export interface AiConnectionTestResult extends AiValidationResult {
  provider: string;
  endpoint: string | null;
  statusCode: number | null;
  latencyMs: number | null;
}

interface AiValidationOptions {
  allowDisabled?: boolean;
}

const SETTINGS_STORAGE_KEY = "animetrack.settings";

const DEFAULT_SETTINGS: AppSettings = {
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

type SettingsCommand = "load_settings" | "save_settings" | "test_ai_connection";

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

function normalizeAiSettings(value: unknown): AiProviderSettings {
  const record = isRecord(value) ? value : {};

  return {
    enabled: Boolean(record.enabled),
    provider: normalizeText(record.provider, DEFAULT_SETTINGS.ai.provider),
    baseUrl: normalizeText(record.baseUrl, DEFAULT_SETTINGS.ai.baseUrl).replace(/\/+$/, ""),
    model: normalizeText(record.model, DEFAULT_SETTINGS.ai.model),
    apiKey: normalizeOptionalText(record.apiKey),
  };
}

function normalizeSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};

  return {
    displayName: normalizeText(record.displayName, DEFAULT_SETTINGS.displayName),
    theme: typeof record.theme === "string" && isAppTheme(record.theme) ? record.theme : DEFAULT_SETTINGS.theme,
    ai: normalizeAiSettings(record.ai),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : null,
  };
}

function stripSettingsSecrets(value: AppSettings) {
  return normalizeSettings({
    ...value,
    ai: {
      ...value.ai,
      apiKey: "",
    },
  });
}

function mergeSettings(base: AppSettings, override?: Partial<AppSettings>) {
  if (!override) {
    return base;
  }

  const aiOverride = isRecord(override.ai) ? override.ai : {};

  return normalizeSettings({
    ...base,
    ...override,
    ai: {
      ...base.ai,
      ...aiOverride,
    },
  });
}

function hasPersistedCustomSettings(value: AppSettings) {
  return value.updatedAt !== null
    || value.displayName !== DEFAULT_SETTINGS.displayName
    || value.theme !== DEFAULT_SETTINGS.theme
    || value.ai.enabled !== DEFAULT_SETTINGS.ai.enabled
    || value.ai.provider !== DEFAULT_SETTINGS.ai.provider
    || value.ai.baseUrl !== DEFAULT_SETTINGS.ai.baseUrl
    || value.ai.model !== DEFAULT_SETTINGS.ai.model
    || value.ai.apiKey !== DEFAULT_SETTINGS.ai.apiKey;
}

function readSettingsFromLocalStorage() {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return DEFAULT_SETTINGS;
  }

  try {
    return normalizeSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettingsToLocalStorage(value: AppSettings) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  }
}

async function invokeSettingsCommand<T>(command: SettingsCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

async function persistSettingsToTauri(value: AppSettings) {
  const response = await invokeSettingsCommand<AppSettings>("save_settings", { settings: value });
  return response ? normalizeSettings(response) : null;
}

function normalizeAiConnectionTestResult(value: unknown, fallback: AiProviderSettings): AiConnectionTestResult {
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

export function getCachedSettings(fallback?: AppSettings) {
  return mergeSettings(readSettingsFromLocalStorage(), fallback);
}

export async function loadSettings(fallback?: AppSettings) {
  const cachedSettings = getCachedSettings(fallback);
  const response = await invokeSettingsCommand<AppSettings>("load_settings");

  if (!response) {
    writeSettingsToLocalStorage(cachedSettings);
    return cachedSettings;
  }

  const tauriSettings = normalizeSettings(response);
  if (!tauriSettings.ai.apiKey && cachedSettings.ai.apiKey) {
    const migratedSettings = await persistSettingsToTauri({
      ...tauriSettings,
      ai: {
        ...tauriSettings.ai,
        apiKey: cachedSettings.ai.apiKey,
      },
    });

    if (migratedSettings) {
      writeSettingsToLocalStorage(stripSettingsSecrets(migratedSettings));
      return migratedSettings;
    }
  }

  if (tauriSettings.updatedAt === null && hasPersistedCustomSettings(cachedSettings)) {
    const migratedSettings = await persistSettingsToTauri(cachedSettings);
    if (migratedSettings) {
      writeSettingsToLocalStorage(stripSettingsSecrets(migratedSettings));
      return migratedSettings;
    }

    writeSettingsToLocalStorage(cachedSettings);
    return cachedSettings;
  }

  writeSettingsToLocalStorage(stripSettingsSecrets(tauriSettings));
  return tauriSettings;
}

export async function saveSettings(value: AppSettings) {
  const nextSettings = normalizeSettings({
    ...value,
    updatedAt: new Date().toISOString(),
  });

  const persistedSettings = await persistSettingsToTauri(nextSettings);
  if (persistedSettings) {
    writeSettingsToLocalStorage(stripSettingsSecrets(persistedSettings));
    return persistedSettings;
  }

  writeSettingsToLocalStorage(nextSettings);
  return nextSettings;
}

export function getDefaultSettings() {
  return DEFAULT_SETTINGS;
}

export function validateAiSettings(
  value: AiProviderSettings,
  options?: AiValidationOptions,
): AiValidationResult {
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

export async function testAiConnection(value: AiProviderSettings): Promise<AiConnectionTestResult> {
  const normalizedSettings = normalizeAiSettings(value);
  const response = await invokeSettingsCommand<AiConnectionTestResult>("test_ai_connection", {
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