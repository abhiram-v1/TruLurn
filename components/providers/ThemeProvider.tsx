'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { applyTheme, isTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme'

type ThemeContextValue = {
  theme: Theme
  mounted: boolean
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
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

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme
    setThemeState(currentTheme === 'dark' ? 'dark' : 'light')
    setMounted(true)

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY || !isTheme(event.newValue)) return
      applyTheme(event.newValue)
      setThemeState(event.newValue)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo(
    () => ({ theme, mounted, setTheme }),
    [mounted, setTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
