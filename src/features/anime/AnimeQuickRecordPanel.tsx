"use client";

import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/outline';
import type { QuickRecordTraceEvent } from '@/src/lib/quick-record';

type AnimeQuickRecordPanelProps = {
  quickInput: string;
  quickLoading: boolean;
  quickMessage: string;
  quickTrace: QuickRecordTraceEvent[];
  onInputChange: (value: string) => void;
  onSubmit: () => void;
};

function getTraceIcon(event: QuickRecordTraceEvent) {
  if (event.status === 'error') {
    return <ExclamationTriangleIcon className="h-4 w-4 text-red-400" />;
  }

  if (event.status === 'warning') {
    return <ExclamationTriangleIcon className="h-4 w-4 text-amber-400" />;
  }

  if (event.status === 'success') {
    return <CheckCircleIcon className="h-4 w-4 theme-accent-text" />;
  }

  if (event.stage === 'metadata' || event.stage === 'match') {
    return <MagnifyingGlassIcon className="h-4 w-4 text-sky-300" />;
  }

  return <ClockIcon className="h-4 w-4 text-zinc-400" />;
}

export default function AnimeQuickRecordPanel({
  quickInput,
  quickLoading,
  quickMessage,
  quickTrace,
  onInputChange,
  onSubmit,
}: AnimeQuickRecordPanelProps) {
  return (
    <section className="surface-card rounded-2xl p-5 shadow-xl">
      <div className="flex items-center gap-2 text-sm font-bold text-zinc-300 uppercase tracking-wider">
        <SparklesIcon className="theme-accent-text w-4 h-4" />
        AI 动漫录入
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mt-3 flex flex-col md:flex-row gap-2"
      >
        <input
          type="text"
          value={quickInput}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="输入一部或多部动漫名称"
          className="surface-input theme-focus-accent flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500"
        />
        <button
          type="submit"
          disabled={quickLoading}
          className="theme-accent-button rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {quickLoading ? '录入中...' : 'AI录入'}
        </button>
      </form>

      <p className="text-xs text-zinc-500 mt-2">支持输入一部或多部动漫名称；AI 会补齐缺失的作品资料，并继续沿用当前的重刷识别与记录路径。</p>
      {quickMessage && (
        <p className={`text-xs mt-2 ${quickMessage.includes('失败') || quickMessage.includes('请输入') ? 'text-red-400' : 'theme-accent-text'}`}>
          {quickMessage}
        </p>
      )}

      {(quickLoading || quickTrace.length > 0) && (
        <div className="surface-card-muted mt-4 rounded-2xl p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">AI 录入过程</p>
              <p className="mt-1 text-xs text-zinc-500">展示解析、本地匹配、元数据查询和写入结果。</p>
            </div>
            {quickLoading && <span className="text-[11px] text-zinc-400">处理中...</span>}
          </div>

          <div className="mt-3 space-y-2">
            {quickTrace.map((event, index) => (
              <div
                key={`${event.timestamp}-${index}`}
                className="rounded-xl border border-[color:var(--surface-pill-border)] bg-[var(--surface-pill-bg)] px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{getTraceIcon(event)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-zinc-100">{event.title}</p>
                      {event.recordTitle && <span className="text-[11px] text-zinc-400">{event.recordTitle}</span>}
                    </div>
                    {event.detail && <p className="mt-1 text-xs leading-5 text-zinc-400">{event.detail}</p>}
                    {event.queries && event.queries.length > 0 && (
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">查询词：{event.queries.join(' / ')}</p>
                    )}
                    {event.candidates && event.candidates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {event.candidates.map((candidate) => (
                          <span
                            key={`${candidate.id}-${candidate.title}`}
                            className={`rounded-full border px-2 py-1 text-[11px] leading-none ${event.selectedTitle === candidate.title ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200' : 'border-[color:var(--surface-pill-border)] bg-[var(--surface-pill-bg)] text-zinc-400'}`}
                          >
                            {candidate.title}
                            {typeof candidate.season === 'number' ? ` S${candidate.season}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {(event.matchedTitle || event.selectedTitle) && (
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                        {event.matchedTitle ? `本地命中：${event.matchedTitle}` : ''}
                        {event.matchedTitle && event.selectedTitle ? '；' : ''}
                        {event.selectedTitle ? `采用元数据：${event.selectedTitle}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}