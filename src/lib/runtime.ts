export interface RuntimeInfo {
  appName: string;
  appVersion: string;
  storageMode: string;
  appDataDir: string | null;
  databasePath: string | null;
  schemaVersion: number | null;
}

export async function readRuntimeInfo(): Promise<RuntimeInfo | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<RuntimeInfo>("get_runtime_info");
  } catch {
    return null;
  }
}