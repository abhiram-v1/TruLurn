export const THEME_STORAGE_KEY = 'trulurn-theme'

export type Theme = 'light' | 'dark'

export function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
