"use client";

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

const variantStyles = {
  danger: {
    icon: 'bg-red-500/10 border-red-500/20',
    iconColor: 'text-red-400',
    button: 'bg-red-500/15 border-red-500/25 text-red-200 hover:bg-red-500/25',
    iconPath: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  },
  warning: {
    icon: 'bg-amber-500/10 border-amber-500/20',
    iconColor: 'text-amber-400',
    button: 'bg-amber-500/15 border-amber-500/25 text-amber-200 hover:bg-amber-500/25',
    iconPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  },
  default: {
    icon: 'bg-blue-500/10 border-blue-500/20',
    iconColor: 'text-blue-400',
    button: 'bg-blue-500/15 border-blue-500/25 text-blue-200 hover:bg-blue-500/25',
    iconPath: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z',
  },
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const style = variantStyles[variant];

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="relative glass-panel-strong rounded-[24px] p-6 max-w-sm w-full space-y-5 animate-fade-in"
      >
        <div className={`w-12 h-12 mx-auto rounded-2xl border flex items-center justify-center ${style.icon}`}>
          <svg className={`w-6 h-6 ${style.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={style.iconPath} />
          </svg>
        </div>
        <div className="text-center">
          <h3 id="confirm-title" className="text-base font-display font-semibold text-zinc-100">{title}</h3>
          <p id="confirm-message" className="mt-2 text-sm text-zinc-400 leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="surface-pill flex-1 px-4 py-2.5 rounded-xl text-zinc-300 text-sm font-medium hover:bg-white/10 transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${style.button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
