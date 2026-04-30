"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { APP_THEMES, type AppTheme, DEFAULT_THEME, isAppTheme, THEME_STORAGE_KEY } from '@/lib/theme';

type ThemeContextValue = {
  theme: AppTheme;
  setTheme: (nextTheme: AppTheme) => void;
  themes: typeof APP_THEMES;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): AppTheme {
  if (typeof document !== 'undefined') {
    const datasetTheme = document.documentElement.dataset.theme;
    if (isAppTheme(datasetTheme)) {
      return datasetTheme;
    }
  }

  if (typeof window !== 'undefined') {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isAppTheme(savedTheme)) {
      return savedTheme;
    }
  }

  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: setThemeState,
    themes: APP_THEMES,
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}