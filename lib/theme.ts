export const THEME_STORAGE_KEY = 'anime_track_theme';

export const APP_THEMES = [
  {
    value: 'obsidian',
    label: '黑曜',
    description: '偏黑冷灰',
    preview: '#bcc7da',
    heroOverlay: 'linear-gradient(120deg, rgba(7,9,13,0.9), rgba(7,9,13,0.44) 44%, rgba(7,9,13,0.9))',
    premierePalette: ['#bcc7da', '#8795ae', '#6f7f99', '#deb36d', '#d08f90', '#9aa3ba', '#b07a59'],
  },
  {
    value: 'verdant',
    label: '森绿',
    description: '原始绿调',
    preview: '#56d39c',
    heroOverlay: 'linear-gradient(120deg, rgba(6,13,12,0.88), rgba(6,13,12,0.4) 44%, rgba(6,13,12,0.88))',
    premierePalette: ['#5dd6f2', '#56d39c', '#8da6ff', '#f4bf62', '#fb7185', '#a78bfa', '#f97316'],
  },
  {
    value: 'abyss',
    label: '海渊',
    description: '深海蓝潮',
    preview: '#72c7ff',
    heroOverlay: 'linear-gradient(120deg, rgba(4,12,18,0.92), rgba(4,12,18,0.46) 44%, rgba(4,12,18,0.9))',
    premierePalette: ['#72c7ff', '#5fd0ff', '#7c9bff', '#f6bf70', '#5eead4', '#c4b5fd', '#38bdf8'],
  },
  {
    value: 'ember',
    label: '余烬',
    description: '黑铜暖调',
    preview: '#f2a65a',
    heroOverlay: 'linear-gradient(120deg, rgba(14,8,7,0.92), rgba(14,8,7,0.46) 44%, rgba(14,8,7,0.9))',
    premierePalette: ['#f2a65a', '#ef7d57', '#ffd166', '#fb7185', '#d6b38a', '#c97a63', '#facc15'],
  },
  {
    value: 'garnet',
    label: '绯石',
    description: '酒红夜色',
    preview: '#e784a6',
    heroOverlay: 'linear-gradient(120deg, rgba(12,7,10,0.92), rgba(12,7,10,0.46) 44%, rgba(12,7,10,0.9))',
    premierePalette: ['#e784a6', '#fb7185', '#c084fc', '#f4bf62', '#f9a8d4', '#a78bfa', '#fda4af'],
  },
] as const;

export type AppTheme = (typeof APP_THEMES)[number]['value'];
export type AppThemeDefinition = (typeof APP_THEMES)[number];

const APP_THEME_VALUES = APP_THEMES.map((theme) => theme.value) as readonly AppTheme[];

const APP_THEME_MAP = new Map<AppTheme, AppThemeDefinition>(
  APP_THEMES.map((theme) => [theme.value, theme])
);

export const DEFAULT_THEME: AppTheme = 'verdant';

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  return typeof value === 'string' && APP_THEME_VALUES.includes(value as AppTheme);
}

export function getAppThemeDefinition(theme: AppTheme): AppThemeDefinition {
  return APP_THEME_MAP.get(theme) ?? APP_THEMES[0];
}

export const themeInitScript = `(() => {
  try {
    const savedTheme = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    const supportedThemes = ${JSON.stringify(APP_THEME_VALUES)};
    const theme = supportedThemes.includes(savedTheme)
      ? savedTheme
      : '${DEFAULT_THEME}';

    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = '${DEFAULT_THEME}';
  }
})();`;