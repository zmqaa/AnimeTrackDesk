import type { AnimeStatus } from "@/lib/anime-shared";
import { readDesktopRuntimeInfo } from "@/src/lib/desktop";
import {
  getDesktopAnimeStorageSnapshot,
  replaceDesktopAnimeStorageSnapshot,
  type DesktopAnimeStorageEntry,
} from "@/src/lib/desktop-anime-store";
import type { WatchHistoryEntry } from "../types";

export interface DesktopBackupFile {
  name: string;
  size: number;
  createdAt: string;
}

interface StoredDesktopBackupFile extends DesktopBackupFile {
  content: string;
}

interface DesktopBackupPayload {
  schemaVersion: 1;
  source: "animetrack";
  createdAt: string;
  entries: DesktopAnimeStorageEntry[];
  history: WatchHistoryEntry[];
}

interface DesktopSaveTextFileFilter {
  name: string;
  extensions: string[];
}

interface DesktopTextFileDescriptor {
  fileName: string;
  content: string;
  mimeType: string;
  filters: DesktopSaveTextFileFilter[];
}

interface DesktopNativeSaveFileResult {
  canceled: boolean;
  path: string | null;
}

export interface DesktopSavedFileResult {
  fileName: string;
  canceled: boolean;
  mode: "native-dialog" | "browser-download";
  path: string | null;
}

type DesktopBackupCommand = "list_desktop_backups" | "save_desktop_backup" | "read_desktop_backup" | "delete_desktop_backup" | "save_desktop_text_file";

const BACKUP_STORAGE_KEY = "animetrack.backups";
const MAX_BACKUP_RECORDS = 12;

function readStoredBackups() {
  if (typeof window === "undefined") {
    return [] as StoredDesktopBackupFile[];
  }

  const rawValue = window.localStorage.getItem(BACKUP_STORAGE_KEY);
  if (!rawValue) {
    return [] as StoredDesktopBackupFile[];
  }

  try {
    const parsedValue = JSON.parse(rawValue) as StoredDesktopBackupFile[];
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [] as StoredDesktopBackupFile[];
  }
}

function persistStoredBackups(backups: StoredDesktopBackupFile[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups));
}

function clearStoredBackups() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(BACKUP_STORAGE_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function padBackupDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function createBackupName(createdAt: string) {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return `animetrack-backup-${createdAt.replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z").replace("T", "_")}.json`;
  }

  const localTimestamp = [
    parsed.getFullYear(),
    padBackupDatePart(parsed.getMonth() + 1),
    padBackupDatePart(parsed.getDate()),
  ].join("-") + "_" + [
    padBackupDatePart(parsed.getHours()),
    padBackupDatePart(parsed.getMinutes()),
    padBackupDatePart(parsed.getSeconds()),
  ].join("-");

  return `animetrack-backup-${localTimestamp}.json`;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function mapStoredStatus(status: DesktopAnimeStorageEntry["status"]): AnimeStatus {
  if (status === "planned") {
    return "plan_to_watch";
  }

  if (status === "paused") {
    return "dropped";
  }

  return status;
}

function buildExportAnimeRecords(entries: DesktopAnimeStorageEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    originalTitle: entry.originalTitle || undefined,
    coverUrl: entry.coverUrl || undefined,
    status: mapStoredStatus(entry.status),
    score: entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
    totalEpisodes: entry.episodes > 0 ? entry.episodes : undefined,
    durationMinutes: entry.durationMinutes || undefined,
    notes: entry.notes || undefined,
    tags: entry.tags,
    summary: entry.summary || undefined,
    startDate: entry.startDate || undefined,
    endDate: entry.endDate || undefined,
    premiereDate: entry.premiereDate || undefined,
    isFinished: entry.isFinished,
    cast: entry.cast,
    castAliases: entry.castAliases,
    createdAt: entry.createdAt || entry.updatedAt,
    updatedAt: entry.updatedAt,
    lastWatchedAt: entry.lastWatchedAt,
  }));
}

function buildExportHistoryRecords(history: WatchHistoryEntry[]) {
  return history.map((record) => ({
    id: record.id,
    animeId: record.animeId,
    animeTitle: record.animeTitle,
    episode: record.episode,
    watchedAt: record.watchedAt,
    note: record.note || undefined,
  }));
}

function buildCsvContent(entries: DesktopAnimeStorageEntry[], history: WatchHistoryEntry[]) {
  const lines: string[] = [];
  const animeHeaders = ["ID", "标题", "原标题", "状态", "评分", "进度", "总集数", "时长(分钟)", "首播日期", "开始日期", "结束日期", "标签", "备注"];
  lines.push(animeHeaders.map(escapeCsvValue).join(","));

  for (const anime of buildExportAnimeRecords(entries)) {
    lines.push([
      anime.id,
      anime.title,
      anime.originalTitle || "",
      anime.status,
      anime.score ?? "",
      anime.progress,
      anime.totalEpisodes ?? "",
      anime.durationMinutes ?? "",
      anime.premiereDate || "",
      anime.startDate || "",
      anime.endDate || "",
      (anime.tags || []).join("|"),
      anime.notes || "",
    ].map(escapeCsvValue).join(","));
  }

  if (entries.length > 0 && history.length > 0) {
    lines.push("");
  }

  const historyHeaders = ["ID", "番剧ID", "番剧名称", "集数", "观看时间"];
  lines.push(historyHeaders.map(escapeCsvValue).join(","));

  for (const record of buildExportHistoryRecords(history)) {
    lines.push([
      record.id,
      record.animeId,
      record.animeTitle,
      record.episode,
      record.watchedAt,
    ].map(escapeCsvValue).join(","));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function parseImportedData(rawText: string) {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawText);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (!parsedValue || typeof parsedValue !== "object") {
    throw new Error("导入文件格式无效");
  }

  const record = parsedValue as Record<string, unknown>;
  if (Array.isArray(record.entries) && Array.isArray(record.history)) {
    return {
      entries: record.entries,
      history: record.history,
      sourceLabel: "桌面快照",
    };
  }

  const anime = record.anime && typeof record.anime === "object" ? (record.anime as Record<string, unknown>) : null;
  const watchHistory = record.watchHistory && typeof record.watchHistory === "object"
    ? (record.watchHistory as Record<string, unknown>)
    : null;
  const animeRecords = anime && Array.isArray(anime.records) ? anime.records : null;
  const historyRecords = watchHistory && Array.isArray(watchHistory.records) ? watchHistory.records : [];

  if (animeRecords) {
    return {
      entries: animeRecords,
      history: historyRecords,
      sourceLabel: "JSON 导出",
    };
  }

  throw new Error("仅支持桌面快照或 JSON 导出文件");
}

function parseBackupPayload(rawText: string): DesktopBackupPayload {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawText);
  } catch {
    throw new Error("备份文件格式无效");
  }

  if (!parsedValue || typeof parsedValue !== "object") {
    throw new Error("备份文件格式无效");
  }

  const record = parsedValue as Partial<DesktopBackupPayload>;
  if (!Array.isArray(record.entries) || !Array.isArray(record.history)) {
    throw new Error("备份文件格式无效");
  }

  return {
    schemaVersion: 1,
    source: "animetrack",
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : new Date().toISOString(),
    entries: record.entries,
    history: record.history,
  };
}

function normalizeNativeSaveFileResult(value: unknown): DesktopNativeSaveFileResult {
  const record = isRecord(value) ? value : {};

  return {
    canceled: Boolean(record.canceled),
    path: typeof record.path === "string" && record.path.trim() ? record.path : null,
  };
}

function triggerBrowserDownload(file: DesktopTextFileDescriptor) {
  if (typeof window === "undefined") {
    throw new Error("当前环境无法触发浏览器下载");
  }

  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveDesktopTextFile(file: DesktopTextFileDescriptor): Promise<DesktopSavedFileResult> {
  const runtimeInfo = await readDesktopRuntimeInfo();
  if (!runtimeInfo) {
    triggerBrowserDownload(file);
    return {
      fileName: file.fileName,
      canceled: false,
      mode: "browser-download",
      path: null,
    };
  }

  const result = await invokeDesktopBackupCommand<DesktopNativeSaveFileResult>("save_desktop_text_file", {
    request: {
      suggestedName: file.fileName,
      content: file.content,
      filters: file.filters,
    },
  });

  if (!result.ok) {
    throw new Error("打开原生保存对话框失败");
  }

  const normalizedResult = normalizeNativeSaveFileResult(result.value);
  return {
    fileName: file.fileName,
    canceled: normalizedResult.canceled,
    mode: "native-dialog",
    path: normalizedResult.path,
  };
}

function buildDesktopBackupPayload(): DesktopBackupPayload {
  const snapshot = getDesktopAnimeStorageSnapshot();
  return {
    schemaVersion: 1,
    source: "animetrack",
    createdAt: new Date().toISOString(),
    entries: snapshot.entries,
    history: snapshot.history,
  };
}

async function invokeDesktopBackupCommand<T>(command: DesktopBackupCommand, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return {
      ok: true as const,
      value: await invoke<T>(command, args),
    };
  } catch {
    return {
      ok: false as const,
    };
  }
}

async function migrateStoredBackupsToTauri() {
  const localBackups = readStoredBackups();
  if (localBackups.length === 0) {
    return null;
  }

  try {
    for (const backup of localBackups) {
      const payload = parseBackupPayload(backup.content);
      const result = await invokeDesktopBackupCommand<DesktopBackupFile>("save_desktop_backup", { payload });
      if (!result.ok) {
        return null;
      }
    }
  } catch {
    return null;
  }

  clearStoredBackups();
  const refreshed = await invokeDesktopBackupCommand<DesktopBackupFile[]>("list_desktop_backups");
  return refreshed.ok ? refreshed.value : null;
}

export async function listDesktopBackups(): Promise<DesktopBackupFile[]> {
  const tauriBackups = await invokeDesktopBackupCommand<DesktopBackupFile[]>("list_desktop_backups");
  if (tauriBackups.ok) {
    const localBackups = readStoredBackups();
    if (localBackups.length > 0) {
      const migratedBackups = await migrateStoredBackupsToTauri();
      if (migratedBackups) {
        return migratedBackups;
      }
    }

    return tauriBackups.value;
  }

  return readStoredBackups().map(({ content: _content, ...backup }) => backup);
}

export async function createDesktopBackup() {
  const payload = buildDesktopBackupPayload();
  const tauriBackup = await invokeDesktopBackupCommand<DesktopBackupFile>("save_desktop_backup", { payload });
  if (tauriBackup.ok) {
    return tauriBackup.value;
  }

  const content = JSON.stringify(payload, null, 2);
  const backup: StoredDesktopBackupFile = {
    name: createBackupName(payload.createdAt),
    createdAt: payload.createdAt,
    size: new Blob([content]).size,
    content,
  };

  const nextBackups = [backup, ...readStoredBackups().filter((item) => item.name !== backup.name)].slice(0, MAX_BACKUP_RECORDS);
  persistStoredBackups(nextBackups);

  return {
    name: backup.name,
    createdAt: backup.createdAt,
    size: backup.size,
  };
}

export async function deleteDesktopBackup(name: string) {
  const deleted = await invokeDesktopBackupCommand<void>("delete_desktop_backup", { name });
  if (deleted.ok) {
    return;
  }

  persistStoredBackups(readStoredBackups().filter((backup) => backup.name !== name));
}

export async function downloadDesktopBackup(name: string) {
  const backupFromTauri = await invokeDesktopBackupCommand<DesktopBackupPayload>("read_desktop_backup", { name });
  if (backupFromTauri.ok) {
    const content = JSON.stringify(backupFromTauri.value, null, 2);
    return saveDesktopTextFile({
      fileName: createBackupName(backupFromTauri.value.createdAt),
      content,
      mimeType: "application/json;charset=utf-8",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  }

  const backup = readStoredBackups().find((item) => item.name === name);

  if (!backup) {
    throw new Error("未找到对应备份");
  }

  return saveDesktopTextFile({
    fileName: backup.name,
    content: backup.content,
    mimeType: "application/json;charset=utf-8",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
}

export async function restoreDesktopBackup(name: string) {
  const backupFromTauri = await invokeDesktopBackupCommand<DesktopBackupPayload>("read_desktop_backup", { name });
  if (backupFromTauri.ok) {
    const result = await replaceDesktopAnimeStorageSnapshot({
      entries: backupFromTauri.value.entries,
      history: backupFromTauri.value.history,
    });

    return {
      ...result,
      sourceLabel: name,
    };
  }

  const backup = readStoredBackups().find((item) => item.name === name);

  if (!backup) {
    throw new Error("未找到对应备份");
  }

  const parsed = parseImportedData(backup.content);
  const result = await replaceDesktopAnimeStorageSnapshot(parsed);

  return {
    ...result,
    sourceLabel: backup.name,
  };
}

export async function restoreDesktopDataFromText(rawText: string) {
  const parsed = parseImportedData(rawText);
  const result = await replaceDesktopAnimeStorageSnapshot(parsed);

  return {
    ...result,
    sourceLabel: parsed.sourceLabel,
  };
}

export async function exportDesktopData(format: "json" | "csv") {
  const snapshot = getDesktopAnimeStorageSnapshot();

  if (format === "csv") {
    const content = buildCsvContent(snapshot.entries, snapshot.history);
    return saveDesktopTextFile({
      fileName: "anime-track-export.csv",
      content,
      mimeType: "text/csv;charset=utf-8",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
  }

  const content = JSON.stringify({
    exportedAt: new Date().toISOString(),
    anime: {
      count: snapshot.entries.length,
      records: buildExportAnimeRecords(snapshot.entries),
    },
    watchHistory: {
      count: snapshot.history.length,
      records: buildExportHistoryRecords(snapshot.history),
    },
  }, null, 2);

  return saveDesktopTextFile({
    fileName: "anime-track-export.json",
    content,
    mimeType: "application/json;charset=utf-8",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
}