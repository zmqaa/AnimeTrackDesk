"use client";

import { SparklesIcon } from '@heroicons/react/24/outline';

type AnimeQuickRecordPanelProps = {
  quickInput: string;
  quickLoading: boolean;
  quickMessage: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
};

export default function AnimeQuickRecordPanel({
  quickInput,
  quickLoading,
  quickMessage,
  onInputChange,
  onSubmit,
}: AnimeQuickRecordPanelProps) {
  return (
    <section className="surface-card rounded-2xl p-5 shadow-xl">
      <div className="flex items-center gap-2 text-sm font-bold text-zinc-300 uppercase tracking-wider">
        <SparklesIcon className="theme-accent-text w-4 h-4" />
        AI 一句话录入
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
          placeholder="例如：今天看了 间谍过家家第三季 第1集"
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

      <p className="text-xs text-zinc-500 mt-2">支持自然语言拆成多条记录；AI 会补齐缺失的作品资料，但不会改开始观看和看完日期。</p>
      {quickMessage && (
        <p className={`text-xs mt-2 ${quickMessage.includes('失败') || quickMessage.includes('请输入') ? 'text-red-400' : 'theme-accent-text'}`}>
          {quickMessage}
        </p>
      )}
    </section>
  );
}