export interface DesktopRuntimeInfo {
  appName: string;
  appVersion: string;
  storageMode: string;
  appDataDir: string | null;
  databasePath: string | null;
  schemaVersion: number | null;
}

export async function readDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DesktopRuntimeInfo>("get_runtime_info");
  } catch {
    return null;
  }
}