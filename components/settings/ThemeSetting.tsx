'use client'

import { IconMoon, IconSun } from '@tabler/icons-react'
import { useTheme } from '@/components/providers/ThemeProvider'

export function ThemeSetting() {
  const { mounted, setTheme, theme } = useTheme()
  const darkMode = theme === 'dark'

  return (
    <div className="settings-row settings-theme-row">
      <span className="settings-theme-copy">
        <span className="settings-theme-icon" aria-hidden="true">
          {darkMode ? <IconMoon size={18} stroke={1.8} /> : <IconSun size={18} stroke={1.8} />}
        </span>
        <span>
          <strong>Dark mode</strong>
          <small>{darkMode ? 'Dark appearance is active' : 'Use the default light appearance'}</small>
        </span>
      </span>
      <button
        aria-checked={darkMode}
        aria-label="Toggle dark mode"
        className="theme-switch"
        disabled={!mounted}
        onClick={() => setTheme(darkMode ? 'light' : 'dark')}
        role="switch"
        type="button"
      >
        <span className="theme-switch-thumb" />
      </button>
    </div>
  )
}
