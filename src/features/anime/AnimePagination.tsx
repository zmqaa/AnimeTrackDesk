"use client";

import { useEffect, useState } from 'react';

type AnimePaginationProps = {
  loading: boolean;
  itemsCount: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export default function AnimePagination({
  loading,
  itemsCount,
  currentPage,
  totalPages,
  onPageChange,
}: AnimePaginationProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  if (loading || itemsCount <= 0) {
    return null;
  }

  const jumpToPage = () => {
    const parsed = Number(pageInput);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }

    const nextPage = Math.min(totalPages, Math.max(1, Math.trunc(parsed)));
    setPageInput(String(nextPage));

    if (nextPage !== currentPage) {
      onPageChange(nextPage);
    }
  };

  return (
    <div className="surface-card-muted flex flex-col gap-3 rounded-2xl px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="surface-pill px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          首页
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="surface-pill px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="surface-pill px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下一页
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="surface-pill px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          末页
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>第 {currentPage} / {totalPages} 页</span>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            jumpToPage();
          }}
          className="flex items-center gap-2"
        >
          <span>跳至</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={jumpToPage}
            className="surface-input theme-focus-accent w-16 rounded-lg px-2 py-1.5 text-center text-xs text-zinc-200 outline-none"
          />
          <span>页</span>
        </form>
      </div>
    </div>
  );
}