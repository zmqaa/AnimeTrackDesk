import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { formatLocalDateTimeString } from "@/lib/local-date-time";
import {
  clearData,
  createBackup,
  deleteBackup,
  downloadBackup,
  exportData,
  listBackups,
  restoreBackup,
  restoreDataFromText,
  type BackupFile,
} from "@/src/lib/backup-store";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

type RestoreCandidate =
  | { type: "backup"; name: string }
  | { type: "file"; name: string; content: string };

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return formatLocalDateTimeString(iso);
}

export default function BackupPage() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<RestoreCandidate | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshBackups = useCallback(async () => {
    setLoading(true);
    try {
      setBackups(await listBackups());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载备份列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  const handleCreateBackup = useCallback(async () => {
    setCreating(true);
    try {
      const backup = await createBackup();
      await refreshBackups();
      toast.success(`已创建快照 ${backup.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建快照失败");
    } finally {
      setCreating(false);
    }
  }, [refreshBackups]);

  const handleExport = useCallback(async (format: "json" | "csv") => {
    setExporting(format);
    try {
      const result = await exportData(format);
      if (result.canceled) {
        return;
      }

      toast.success(result.mode === "native-dialog"
        ? `${format.toUpperCase()} 已保存到本地文件`
        : `${format.toUpperCase()} 已开始下载`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(null);
    }
  }, []);

  const handleDownload = useCallback(async (name: string) => {
    try {
      const result = await downloadBackup(name);
      if (result.canceled) {
        return;
      }

      toast.success(result.mode === "native-dialog" ? "快照已保存到本地文件" : "快照已开始下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    }
  }, []);

  const handleDeleteBackup = useCallback(async (name: string) => {
    try {
      await deleteBackup(name);
      await refreshBackups();
      toast.success("已删除快照");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeleteConfirm(null);
    }
  }, [refreshBackups]);

  const handleChooseImportFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) {
      return;
    }

    try {
      const content = await selectedFile.text();
      setRestoreConfirm({
        type: "file",
        name: selectedFile.name,
        content,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取文件失败");
    }
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!restoreConfirm) {
      return;
    }

    setImporting(true);
    try {
      const result = restoreConfirm.type === "backup"
        ? await restoreBackup(restoreConfirm.name)
        : await restoreDataFromText(restoreConfirm.content);

      await refreshBackups();
      toast.success(`已恢复 ${result.animeCount} 部番剧和 ${result.historyCount} 条历史`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setImporting(false);
      setRestoreConfirm(null);
    }
  }, [refreshBackups, restoreConfirm]);

  const handleClearData = useCallback(async () => {
    setClearing(true);
    try {
      await clearData();
      toast.success("已清空当前番剧与观看历史");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空失败");
    } finally {
      setClearing(false);
      setClearConfirm(false);
    }
  }, []);

  return (
    <main className="p-4 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-display tracking-tight text-zinc-100">备份与导出</h1>
        <p className="text-base text-zinc-500 mt-2">导出当前桌面数据，创建和恢复本地快照</p>
      </div>

      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8">
        <h2 className="text-lg font-medium text-zinc-200 mb-2">导出数据</h2>
        <p className="text-sm text-zinc-500 mb-5">
          导出全部番剧列表和观看记录。CSV 格式可直接用 Excel 打开，JSON 既适合程序处理，也可用于后续恢复到桌面端。
        </p>
        <p className="text-xs text-zinc-500/90 mb-5">
          桌面运行时会弹出原生保存对话框；当前如果只是浏览器预览环境，则会自动回退为浏览器下载。
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting === "csv" ? "导出中..." : "导出 CSV（Excel）"}
          </button>
          <button
            onClick={() => handleExport("json")}
            disabled={exporting !== null}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium hover:bg-blue-500/20 transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting === "json" ? "导出中..." : "导出 JSON"}
          </button>
        </div>
      </section>

      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-medium text-zinc-200">导入恢复</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleChooseImportFile}
              disabled={importing || clearing}
              className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm font-medium hover:bg-amber-500/20 transition-all disabled:opacity-50 w-fit"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h10m-10 5h16" />
              </svg>
              选择 JSON 文件
            </button>
            <button
              onClick={() => setClearConfirm(true)}
              disabled={importing || clearing}
              className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm font-medium hover:bg-red-500/20 transition-all disabled:opacity-50 w-fit"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12m-9 4v6m6-6v6M9 4h6l1 3H8l1-3Zm-3 3h14l-1 12a2 2 0 01-2 2H7a2 2 0 01-2-2L4 7Z" />
              </svg>
              {clearing ? "清空中..." : "清空当前数据"}
            </button>
          </div>
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          支持导入本页导出的 JSON 文件，或从下方下载的桌面快照文件。恢复会覆盖当前桌面端数据，CSV 只用于查看，不支持直接导入。
        </p>
        <p className="text-xs text-zinc-500/90 mb-6">
          如果这台设备之后要交给别人使用，可以先点“清空当前数据”恢复为空库。下方已经保存的本地快照不会自动删除，如需彻底移交，请一并删除。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportFileChange}
        />
      </section>

      <section className="glass-panel rounded-3xl border border-white/5 p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-medium text-zinc-200">本地快照</h2>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium hover:bg-violet-500/20 transition-all disabled:opacity-50 w-fit"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {creating ? "创建中..." : "立即创建快照"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          将当前桌面端的番剧与观看记录保存为本地快照，便于快速回滚、迁移到其他设备，或在 SQLite 仓储接入前保留多份恢复点。
        </p>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-16 bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            暂无本地快照，点击「立即创建快照」保存第一个恢复点
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.name}
                className="surface-card-muted flex items-center justify-between px-5 py-4 rounded-2xl hover:bg-white/[0.04] transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm md:text-base text-zinc-300 truncate font-medium">{backup.name}</p>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1">
                    {formatDate(backup.createdAt)} · {formatSize(backup.size)}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4 shrink-0">
                  <button
                    onClick={() => setRestoreConfirm({ type: "backup", name: backup.name })}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 transition-all"
                    title="恢复"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h4l3-3m0 0l3 3M10 7v8a4 4 0 004 4h5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDownload(backup.name)}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-blue-300 hover:bg-blue-500/10 transition-all"
                    title="下载"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(backup.name)}
                    className="p-2.5 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="删除"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="删除快照"
        message={`确定要删除快照文件 ${deleteConfirm} 吗？`}
        confirmText="删除"
        variant="danger"
        onConfirm={() => deleteConfirm && handleDeleteBackup(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />

      <ConfirmDialog
        open={restoreConfirm !== null}
        title="恢复数据"
        message={restoreConfirm
          ? `确定要用 ${restoreConfirm.name} 覆盖当前桌面端数据吗？当前番剧和观看历史会被替换。`
          : ""}
        confirmText={importing ? "恢复中..." : "确认恢复"}
        onConfirm={confirmRestore}
        onCancel={() => !importing && setRestoreConfirm(null)}
      />

      <ConfirmDialog
        open={clearConfirm}
        title="清空当前数据"
        message="确定要清空当前番剧与观看历史吗？这会把当前使用中的数据恢复为空库，但不会自动删除下方已有的本地快照。"
        confirmText={clearing ? "清空中..." : "确认清空"}
        variant="danger"
        onConfirm={handleClearData}
        onCancel={() => !clearing && setClearConfirm(false)}
      />
    </main>
  );
}