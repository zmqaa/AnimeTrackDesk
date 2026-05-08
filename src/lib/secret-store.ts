export type SecretKey = "ai-api-key";
export type SecretStorageMode = "os-keychain" | "encrypted-sqlite" | "local-storage";

type SecretCommand = "load_secret" | "save_secret" | "delete_secret";

interface SecretValueResponse {
  value: string | null;
  storageMode: Exclude<SecretStorageMode, "local-storage">;
}

interface SecretMutationResponse {
  storageMode: Exclude<SecretStorageMode, "local-storage">;
}

interface SecretLoadResult {
  value: string | null;
  storageMode: Exclude<SecretStorageMode, "local-storage"> | null;
}

interface SecretMutationResult {
  storageMode: Exclude<SecretStorageMode, "local-storage"> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSecretStorageMode(value: unknown): Exclude<SecretStorageMode, "local-storage"> | null {
  if (value === "os-keychain" || value === "encrypted-sqlite") {
    return value;
  }

  return null;
}

async function invokeSecretCommand<T>(command: SecretCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function normalizeSecretValueResponse(value: unknown): SecretValueResponse | null {
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

function normalizeSecretMutationResponse(value: unknown): SecretMutationResponse | null {
  const record = isRecord(value) ? value : {};
  const storageMode = normalizeSecretStorageMode(record.storageMode);

  if (!storageMode) {
    return null;
  }

  return {
    storageMode,
  };
}

export async function loadSecret(key: SecretKey): Promise<SecretLoadResult> {
  const response = await invokeSecretCommand<SecretValueResponse>("load_secret", { key });
  const normalizedResponse = normalizeSecretValueResponse(response);

  if (!normalizedResponse) {
    return {
      value: null,
      storageMode: null,
    };
  }

  return normalizedResponse;
}

export async function saveSecret(key: SecretKey, value: string): Promise<SecretMutationResult> {
  const response = await invokeSecretCommand<SecretMutationResponse>("save_secret", { key, value });
  const normalizedResponse = normalizeSecretMutationResponse(response);

  return {
    storageMode: normalizedResponse?.storageMode ?? null,
  };
}

export async function deleteSecret(key: SecretKey): Promise<SecretMutationResult> {
  const response = await invokeSecretCommand<SecretMutationResponse>("delete_secret", { key });
  const normalizedResponse = normalizeSecretMutationResponse(response);

  return {
    storageMode: normalizedResponse?.storageMode ?? null,
  };
}