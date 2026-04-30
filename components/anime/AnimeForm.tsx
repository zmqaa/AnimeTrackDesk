"use client";

import { fetchAnimeMetadata } from '@/lib/anime-provider';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { AnimeStatus, AnimeFormInitialData } from '@/lib/anime-shared';
import { statusLabels } from '@/lib/dashboard-types';

export interface AnimeFormSubmitPayload {
    title: string;
    originalTitle?: string;
    progress: number;
    totalEpisodes?: number;
    status: AnimeStatus;
    notes?: string;
    coverUrl?: string;
    tags: string[];
    durationMinutes?: number;
    startDate?: string;
    endDate?: string;
    isFinished: boolean;
}

interface AnimeFormProps {
  editingId: number | null;
    initialData: AnimeFormInitialData;
    onSubmit: (payload: AnimeFormSubmitPayload) => Promise<void>;
  resetForm: () => void;
  deleteAnime: (id: number) => Promise<void>;
}

export default function AnimeForm({
  editingId,
  initialData,
    onSubmit,
  resetForm,
  deleteAnime
}: AnimeFormProps) {
  const [title, setTitle] = useState(initialData.title || '');
  const [originalTitle, setOriginalTitle] = useState(initialData.originalTitle || '');
  const [progress, setProgress] = useState(initialData.progress || '0');
  const [totalEpisodes, setTotalEpisodes] = useState(initialData.totalEpisodes || '');
  const [status, setStatus] = useState<AnimeStatus>(initialData.status || 'watching');
  const [notes, setNotes] = useState(initialData.notes || '');
  const [coverUrl, setCoverUrl] = useState(initialData.coverUrl || '');
  const [tagsInput, setTagsInput] = useState(initialData.tags || '');
  const [durationMinutes, setDurationMinutes] = useState(initialData.durationMinutes || '');
  const [startDate, setStartDate] = useState(initialData.startDate || '');
  const [endDate, setEndDate] = useState(initialData.endDate || '');
  const [isFinished, setIsFinished] = useState(initialData.isFinished || false);
  const [isFetchingCover, setIsFetchingCover] = useState(false);

  const fetchCover = async (silent = false) => {
    if (!title) {
        if (!silent) toast.error('请先输入番剧名称');
        return;
    }
    setIsFetchingCover(true);
    try {
        const metadata = await fetchAnimeMetadata(title);
         if (metadata) { 
            if (metadata.originalTitle && !originalTitle) setOriginalTitle(metadata.originalTitle);
            if (metadata.coverUrl) setCoverUrl(metadata.coverUrl);
            if (metadata.totalEpisodes && !totalEpisodes) setTotalEpisodes(String(metadata.totalEpisodes));
            if (metadata.description && !notes) setNotes(metadata.description);
            if (metadata.tags?.length && !tagsInput) setTagsInput(metadata.tags.join(', '));
            if (metadata.isFinished !== undefined) setIsFinished(metadata.isFinished);
        } else if (!silent) {
             toast('未找到相关动漫信息', { icon: 'ℹ️' });
        }
    } catch {
        if (!silent) toast.error('获取失败，请稍后再试');
    } finally {
        setIsFetchingCover(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    try {
            const payload: AnimeFormSubmitPayload = {
        title,
                originalTitle: originalTitle || undefined,
        progress: Number(progress),
        totalEpisodes: totalEpisodes ? Number(totalEpisodes) : undefined,
        status,
                notes: notes || undefined,
        coverUrl: coverUrl || undefined,
        tags: tagsInput.split(/[,，]/).map((t: string) => t.trim()).filter(Boolean),
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        isFinished: Boolean(isFinished),
      };

            await onSubmit(payload);
            resetForm();
            toast.success(editingId ? '已保存' : '已添加');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="surface-card p-6 rounded-2xl mb-8 animate-in fade-in slide-in-from-top-4 shadow-lg ring-1 ring-black/5">
      <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-white">{editingId ? '编辑番剧' : '新番入库'}</h2>
          <button type="button" onClick={resetForm} className="text-sm text-zinc-500 hover:text-zinc-300">取消</button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-6 space-y-4">
            <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">番剧名称 <span className="text-red-500">*</span></label>
                <input 
                    value={title} onChange={e => setTitle(e.target.value)}
                    onBlur={() => { if (title && !coverUrl) fetchCover(true); }}
                    className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                    placeholder="例如：葬送的芙莉莲"
                />
            </div>
            <div>
                 <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">原名 (可选)</label>
                 <input 
                     value={originalTitle} onChange={e => setOriginalTitle(e.target.value)}
                     className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition font-sans text-sm text-white"
                 />
            </div>
            <div>
               <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider flex justify-between items-center">
                   <span>封面链接 (可选)</span>
                   <button type="button" onClick={() => fetchCover(false)} disabled={isFetchingCover} className="text-[10px] text-blue-400 hover:text-blue-300">
                       {isFetchingCover ? '搜索中...' : '自动获取封面'}
                   </button>
               </label>
               <div className="flex gap-2">
                   <input 
                       value={coverUrl} onChange={e => setCoverUrl(e.target.value)}
                       className="surface-input flex-1 rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-sm font-mono text-white"
                   />
                   {coverUrl && (
                       <div className="surface-card-muted w-10 h-11 rounded-md overflow-hidden shrink-0">
                           {/* eslint-disable-next-line @next/next/no-img-element */}
                           <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
                       </div>
                   )}
               </div>
            </div>
            <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">标签 (逗号分隔)</label>
                <input 
                    value={tagsInput} onChange={e => setTagsInput(e.target.value)}
                    className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                />
            </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">当前进度</label>
                    <input 
                        type="number" value={progress} onChange={e => setProgress(e.target.value)}
                        className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">总集数</label>
                    <input 
                        type="number" value={totalEpisodes} onChange={e => setTotalEpisodes(e.target.value)}
                        placeholder="未知"
                        className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                    />
                </div>
            </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                     <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">单集时长 (分)</label>
                     <input 
                         type="number" value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)}
                         placeholder="24"
                         className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                     />
                </div>
                 <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">状态</label>
                    <select 
                        value={status} onChange={e => setStatus(e.target.value as AnimeStatus)}
                        className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition appearance-none text-white"
                    >
                        {Object.entries(statusLabels).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                     <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">开始观看日期</label>
                     <input 
                         type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                         className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                     />
                </div>
                <div>
                     <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">看完日期</label>
                     <input 
                         type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                         className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition text-white"
                     />
                </div>
            </div>

            <div className="flex items-center gap-3 py-2">
                <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" checked={isFinished} onChange={e => setIsFinished(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
                <span className="text-xs font-medium text-zinc-400">番剧已完结 (不再更新)</span>
            </div>

            <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">备注 (AI自动补全简介)</label>
                <textarea 
                    value={notes} onChange={e => setNotes(e.target.value)}
                    className="surface-input w-full rounded-lg px-3 py-2.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition min-h-[80px] text-white"
                    rows={3}
                />
            </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
         {editingId && (
             <button type="button" onClick={() => deleteAnime(editingId)} className="px-4 py-2 hover:bg-red-500/10 text-red-600 rounded-lg text-sm mr-auto">删除此番剧</button>
         )}
        <button type="button" onClick={resetForm} className="px-4 py-2 hover:bg-zinc-800 rounded-lg transition text-sm text-zinc-400">取消</button>
        <button type="submit" className="px-6 py-2 bg-white text-black rounded-lg hover:opacity-90 transition text-sm font-medium shadow-sm">
          {editingId ? '保存修改' : '立即添加'}
        </button>
      </div>
    </form>
  );
}
