"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

type RowWithId = { id: number };

export function useDebouncedSearch(onCommit: (value: string) => void, delay = 400) {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setSearchInput(value);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setSearch(value);
      onCommit(value);
    }, delay);
  }, [delay, onCommit]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    search,
    searchInput,
    handleSearchInput,
  };
}

export function useSelectableRows<T extends RowWithId>(rows: T[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((previous) => {
      const allSelected = rows.length > 0 && rows.every((row) => previous.has(row.id));
      return allSelected ? new Set() : new Set(rows.map((row) => row.id));
    });
  }, [rows]);

  const removeSelected = useCallback((ids: number[]) => {
    setSelected((previous) => {
      const next = new Set(previous);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  return {
    selected,
    clearSelection,
    removeSelected,
    toggleSelect,
    toggleSelectAll,
  };
}

export function SearchBar({ value, onChange, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="surface-input w-full pl-11 pr-4 py-3 rounded-2xl text-base text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-400/30 focus:bg-white/[0.06] transition-all"
      />
    </div>
  );
}

export function DeleteButton({ count, onClick, disabled }: {
  count: number;
  onClick: () => void;
  disabled: boolean;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm font-medium hover:bg-red-500/20 transition-all disabled:opacity-50 whitespace-nowrap"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
      删除选中 ({count})
    </button>
  );
}

export function Pagination({ page, totalPages, pageSize, total, onPageChange }: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p className="text-sm text-zinc-500">
        第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条，共 {total} 条
      </p>
      <div className="flex items-center gap-1.5">
        {[
          { label: '首页', disabled: page <= 1, onClick: () => onPageChange(1) },
          { label: '上一页', disabled: page <= 1, onClick: () => onPageChange(Math.max(1, page - 1)) },
        ].map((button) => (
          <button
            key={button.label}
            onClick={button.onClick}
            disabled={button.disabled}
            className="px-3 py-2 rounded-xl text-sm text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {button.label}
          </button>
        ))}
        <span className="px-3 py-2 text-sm text-zinc-300 tabular-nums">{page} / {totalPages}</span>
        {[
          { label: '下一页', disabled: page >= totalPages, onClick: () => onPageChange(Math.min(totalPages, page + 1)) },
          { label: '末页', disabled: page >= totalPages, onClick: () => onPageChange(totalPages) },
        ].map((button) => (
          <button
            key={button.label}
            onClick={button.onClick}
            disabled={button.disabled}
            className="px-3 py-2 rounded-xl text-sm text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-400 focus:ring-emerald-400/30 focus:ring-offset-0 cursor-pointer"
    />
  );
}

export function DeleteIconButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
      title="删除"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.108 0 00-7.5 0" />
      </svg>
    </button>
  );
}

export function SkeletonRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-white/[0.03]">
          {Array.from({ length: cols }).map((_, columnIndex) => (
            <td key={columnIndex} className="px-5 py-4">
              <div className="h-5 bg-white/5 rounded-lg animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}