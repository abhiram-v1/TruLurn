'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  ACCENT_STORAGE_KEY,
  applyAccent,
  applyTheme,
  isAccent,
  isTheme,
  THEME_STORAGE_KEY,
  type Accent,
  type Theme,
} from '@/lib/theme'

type ThemeContextValue = {
  theme: Theme
  accent: Accent
  mounted: boolean
  setTheme: (theme: Theme) => void
  setAccent: (accent: Accent) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [accent, setAccentState] = useState<Accent>('terracotta')
  const [mounted, setMounted] = useState(false)

  const setTheme = useCallback((nextTheme: Theme) => {
    applyTheme(nextTheme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // The theme still applies for this session when storage is unavailable.
    }
    setThemeState(nextTheme)
  }, [])

  const setAccent = useCallback((nextAccent: Accent) => {
    applyAccent(nextAccent)
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent)
    } catch {
      // The accent still applies for this session when storage is unavailable.
    }
    setAccentState(nextAccent)
  }, [])

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme
    const currentAccent = document.documentElement.dataset.accent
    setThemeState(currentTheme === 'dark' ? 'dark' : 'light')
    setAccentState(isAccent(currentAccent) ? currentAccent : 'terracotta')
    setMounted(true)

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) {
        applyTheme(event.newValue)
        setThemeState(event.newValue)
      }
      if (event.key === ACCENT_STORAGE_KEY && isAccent(event.newValue)) {
        applyAccent(event.newValue)
        setAccentState(event.newValue)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo(
    () => ({ theme, accent, mounted, setTheme, setAccent }),
    [accent, mounted, setAccent, setTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
