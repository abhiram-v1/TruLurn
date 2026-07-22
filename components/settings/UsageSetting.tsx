'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

type UsageItem = {
  bucket: string
  label: string
  description: string
  used: number
  limit: number
  remaining: number
}

type UsageSummary = {
  period: 'daily'
  resetAt: string
  items: UsageItem[]
}

function resetLabel(resetAt: string): string {
  const date = new Date(resetAt)
  if (Number.isNaN(date.getTime())) return '00:00 UTC'
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

export function UsageSetting() {
  const { status } = useSession()
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status !== 'authenticated') return
    const controller = new AbortController()

    async function loadUsage() {
      try {
        const response = await fetch('/api/settings/usage', {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load usage.')
        setUsage(body as UsageSummary)
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load usage.')
        }
      }
    }

    void loadUsage()
    return () => controller.abort()
  }, [status])

  if (status === 'unauthenticated') {
    return (
      <div className="usage-settings-panel usage-settings-empty">
        <span>
          <strong>Daily AI usage</strong>
          <small>Sign in to view your beta allowance.</small>
        </span>
        <Link className="button-subtle" href="/auth/signin">Sign in</Link>
      </div>
    )
  }

  if (error) {
    return <div className="usage-settings-panel usage-settings-empty"><p>{error}</p></div>
  }

  if (!usage) {
    return <div className="usage-settings-panel usage-settings-empty"><p>Loading daily usage…</p></div>
  }

  return (
    <section className="usage-settings-panel" aria-labelledby="daily-usage-heading">
      <div className="usage-settings-heading">
        <span>
          <strong id="daily-usage-heading">Daily AI usage</strong>
          <small>Beta allowance · resets at {resetLabel(usage.resetAt)}</small>
        </span>
        <span className="usage-settings-badge">Per account</span>
      </div>
      <div className="usage-meter-list">
        {usage.items.map((item) => {
          const percentage = Math.min(100, Math.round((item.used / Math.max(1, item.limit)) * 100))
          return (
            <div className="usage-meter" key={item.bucket}>
              <div className="usage-meter-copy">
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                <span className="usage-meter-count">{item.used} / {item.limit}</span>
              </div>
              <div
                className="usage-meter-track"
                role="progressbar"
                aria-label={`${item.label}: ${item.used} of ${item.limit} used`}
                aria-valuemin={0}
                aria-valuemax={item.limit}
                aria-valuenow={item.used}
              >
                <span style={{ width: `${percentage}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="usage-settings-note">
        Limits protect the shared beta from automated abuse and unexpected provider charges. Failed provider calls may still count when work has already started.
      </p>
    </section>
  )
}
