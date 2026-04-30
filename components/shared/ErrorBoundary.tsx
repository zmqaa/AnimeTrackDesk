"use client";

import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="max-w-md w-full glass-panel rounded-[28px] p-8 text-center space-y-5">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-display font-semibold text-zinc-100 mb-2">页面出了点问题</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                渲染过程中发生了意外错误，你可以尝试重新加载。
              </p>
              {this.state.error && (
                <p className="mt-3 text-xs text-red-400/70 font-mono bg-red-500/5 rounded-xl px-3 py-2 break-all">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="px-5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-200 text-sm font-medium hover:bg-emerald-500/25 transition-all"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="surface-pill px-5 py-2.5 rounded-xl text-zinc-300 text-sm font-medium hover:bg-white/10 transition-all"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
