export type DesktopSecretKey = "ai-api-key";
export type DesktopSecretStorageMode = "os-keychain" | "encrypted-sqlite" | "local-storage";

type DesktopSecretCommand = "load_desktop_secret" | "save_desktop_secret" | "delete_desktop_secret";

interface DesktopSecretValueResponse {
  value: string | null;
  storageMode: Exclude<DesktopSecretStorageMode, "local-storage">;
}

interface DesktopSecretMutationResponse {
  storageMode: Exclude<DesktopSecretStorageMode, "local-storage">;
}

interface DesktopSecretLoadResult {
  value: string | null;
  storageMode: Exclude<DesktopSecretStorageMode, "local-storage"> | null;
}

interface DesktopSecretMutationResult {
  storageMode: Exclude<DesktopSecretStorageMode, "local-storage"> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSecretStorageMode(value: unknown): Exclude<DesktopSecretStorageMode, "local-storage"> | null {
  if (value === "os-keychain" || value === "encrypted-sqlite") {
    return value;
  }

  return null;
}

async function invokeDesktopSecretCommand<T>(command: DesktopSecretCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function normalizeSecretValueResponse(value: unknown): DesktopSecretValueResponse | null {
  const record = isRecord(value) ? value : {};
  const storageMode = normalizeSecretStorageMode(record.storageMode);

  if (!storageMode) {
    return null;
  }

  return {
    value: typeof record.value === "string" && record.value.trim() ? record.value : null,
    storageMode,
  };
}

function normalizeSecretMutationResponse(value: unknown): DesktopSecretMutationResponse | null {
  const record = isRecord(value) ? value : {};
  const storageMode = normalizeSecretStorageMode(record.storageMode);

  if (!storageMode) {
    return null;
  }

  return {
    storageMode,
  };
}

export async function loadDesktopSecret(key: DesktopSecretKey): Promise<DesktopSecretLoadResult> {
  const response = await invokeDesktopSecretCommand<DesktopSecretValueResponse>("load_desktop_secret", { key });
  const normalizedResponse = normalizeSecretValueResponse(response);

  if (!normalizedResponse) {
    return {
      value: null,
      storageMode: null,
    };
  }

  return normalizedResponse;
}

export async function saveDesktopSecret(key: DesktopSecretKey, value: string): Promise<DesktopSecretMutationResult> {
  const response = await invokeDesktopSecretCommand<DesktopSecretMutationResponse>("save_desktop_secret", { key, value });
  const normalizedResponse = normalizeSecretMutationResponse(response);

  return {
    storageMode: normalizedResponse?.storageMode ?? null,
  };
}

export async function deleteDesktopSecret(key: DesktopSecretKey): Promise<DesktopSecretMutationResult> {
  const response = await invokeDesktopSecretCommand<DesktopSecretMutationResponse>("delete_desktop_secret", { key });
  const normalizedResponse = normalizeSecretMutationResponse(response);

  return {
    storageMode: normalizedResponse?.storageMode ?? null,
  };
}