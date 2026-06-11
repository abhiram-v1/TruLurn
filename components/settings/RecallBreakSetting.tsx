'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

type RecallBreakMode = 'auto' | '30m' | '60m' | 'off'

const MODES: Array<{ id: RecallBreakMode; name: string; description: string }> = [
  { id: 'auto', name: 'Auto', description: 'Break when your concept load says retrieval will help most' },
  { id: '30m', name: 'Every 30 min', description: 'A recall break after each 30 minutes of active study' },
  { id: '60m', name: 'Every 60 min', description: 'A recall break after each 60 minutes of active study' },
  { id: 'off', name: 'Off', description: 'Never prompt — recall stays available from the lesson toolbar' },
]

export function RecallBreakSetting() {
  const { status } = useSession()
  const [mode, setMode] = useState<RecallBreakMode>('auto')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    let alive = true
    fetch('/api/settings/recall')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.mode) setMode(data.mode as RecallBreakMode)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [status])

  async function update(next: RecallBreakMode) {
    if (saving || next === mode) return
    const previous = mode
    setMode(next)
    setSaving(true)
    try {
      const res = await fetch('/api/settings/recall', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      if (!res.ok) setMode(previous)
    } catch {
      setMode(previous)
    } finally {
      setSaving(false)
    }
  }

  const active = MODES.find((m) => m.id === mode) ?? MODES[0]
  const disabled = status !== 'authenticated' || !loaded

  return (
    <div className="settings-row settings-recall-row">
      <span>
        <strong>Recall breaks</strong>
        <small>
          {status !== 'authenticated'
            ? 'Sign in to configure scheduled recall breaks'
            : active.description}
        </small>
      </span>
      <div className="recall-mode-group" role="radiogroup" aria-label="Recall break timing">
        {MODES.map((option) => (
          <button
            key={option.id}
            className={`recall-mode-btn ${mode === option.id ? 'selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            disabled={disabled || saving}
            onClick={() => update(option.id)}
            title={option.description}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  )
}
