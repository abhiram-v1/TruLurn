'use client'

import { IconPalette } from '@tabler/icons-react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { ACCENTS, type Accent } from '@/lib/theme'

const ACCENT_LABELS: Record<Accent, string> = {
  terracotta: 'Terracotta',
  indigo: 'Indigo',
  teal: 'Teal',
  plum: 'Plum',
}

export function AccentSetting() {
  const { accent, mounted, setAccent } = useTheme()

  return (
    <div className="settings-row settings-accent-row">
      <span className="settings-theme-copy">
        <span className="settings-theme-icon" aria-hidden="true">
          <IconPalette size={18} stroke={1.8} />
        </span>
        <span>
          <strong>Accent color</strong>
          <small>{ACCENT_LABELS[accent]} is used for focus, progress, and actions</small>
        </span>
      </span>
      <span className="accent-picker" aria-label="Accent color">
        {ACCENTS.map((option) => (
          <button
            aria-label={`Use ${ACCENT_LABELS[option]} accent`}
            aria-pressed={accent === option}
            className={`accent-swatch accent-swatch-${option}`}
            disabled={!mounted}
            key={option}
            onClick={() => setAccent(option)}
            title={ACCENT_LABELS[option]}
            type="button"
          />
        ))}
      </span>
    </div>
  )
}
