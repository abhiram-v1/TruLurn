export const THEME_STORAGE_KEY = 'trulurn-theme'
export const ACCENT_STORAGE_KEY = 'trulurn-accent'

export type Theme = 'light' | 'dark'
export const ACCENTS = ['terracotta', 'indigo', 'teal', 'plum'] as const
export type Accent = (typeof ACCENTS)[number]

export function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

export function isAccent(value: string | null | undefined): value is Accent {
  return Boolean(value && ACCENTS.includes(value as Accent))
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function applyAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent
}
