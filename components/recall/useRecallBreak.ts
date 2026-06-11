'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Recall break client engine ────────────────────────────────────────────────
// Sends lightweight activity signals while the student studies:
//  - a page_view when the lesson page changes (carries concepts for tracking)
//  - a heartbeat every 60s while the tab is visible
// The server answers each signal with "is a recall break due?". When it is,
// the hook surfaces a prompt; starting the break fetches the generated recall
// page. Ratings are posted on completion, which resets the server watermark.

const HEARTBEAT_MS = 60_000
const SNOOZE_MS = 5 * 60_000

export type RecallOverlayItem = {
  id: string
  type: 'recall' | 'connection' | 'application'
  concept: string
  prompt: string
  answer: string
}

export type RecallOverlayContent = {
  id: string
  headline: string
  summaries: Array<{ concept: string; summary: string }>
  items: RecallOverlayItem[]
}

export type RecallBreakState = {
  breakDue: boolean
  breakReason: string | null
  overlay: RecallOverlayContent | null
  loading: boolean
  error: string | null
  startBreak: (manual?: boolean) => void
  snoozeBreak: () => void
  completeBreak: (ratings: Record<string, 'got_it' | 'shaky' | 'forgot'>) => Promise<{ got_it: number; shaky: number; forgot: number; total: number } | null>
  dismissOverlay: () => void
}

export function useRecallBreak({
  courseId,
  topicId,
  topicTitle,
  pageNumber,
  keyConcepts,
  pageSummary,
}: {
  courseId: string
  topicId: string
  topicTitle: string
  pageNumber: number
  keyConcepts?: string[]
  pageSummary?: string | null
}): RecallBreakState {
  const [breakDue, setBreakDue] = useState(false)
  const [breakReason, setBreakReason] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<RecallOverlayContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const snoozedUntilRef = useRef<number>(0)

  const track = useCallback(
    async (event: 'heartbeat' | 'page_view') => {
      try {
        const res = await fetch('/api/recall/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseId,
            event,
            topicId,
            topicTitle,
            pageNumber,
            keyConcepts,
            summary: pageSummary ?? null,
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.breakDue && Date.now() > snoozedUntilRef.current) {
          setBreakDue(true)
          setBreakReason(typeof data.reason === 'string' ? data.reason : null)
        }
      } catch {
        // Tracking is best-effort — never disturb the lesson over it.
      }
    },
    [courseId, topicId, topicTitle, pageNumber, keyConcepts, pageSummary],
  )

  // Page view on lesson page change.
  useEffect(() => {
    track('page_view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, topicId, pageNumber])

  // Heartbeat while the tab is visible. Paused during an open recall overlay —
  // break time is not study time.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (overlay) return
      track('heartbeat')
    }, HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [track, overlay])

  const startBreak = useCallback(
    async (manual = false) => {
      if (loading) return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/recall/break', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, action: 'start', manual }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Could not start the recall break.')
          if (res.status === 409) setBreakDue(false) // nothing to recall — clear the prompt
          return
        }
        setOverlay(data.recall as RecallOverlayContent)
        setBreakDue(false)
        setBreakReason(null)
      } catch {
        setError('Could not start the recall break.')
      } finally {
        setLoading(false)
      }
    },
    [courseId, loading],
  )

  const snoozeBreak = useCallback(() => {
    snoozedUntilRef.current = Date.now() + SNOOZE_MS
    setBreakDue(false)
    setBreakReason(null)
    fetch('/api/recall/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, action: 'snooze' }),
    }).catch(() => {})
  }, [courseId])

  const completeBreak = useCallback(
    async (ratings: Record<string, 'got_it' | 'shaky' | 'forgot'>) => {
      if (!overlay) return null
      try {
        const res = await fetch('/api/recall/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recallSessionId: overlay.id, ratings }),
        })
        if (!res.ok) return null
        const data = await res.json()
        return data.stats ?? null
      } catch {
        return null
      }
    },
    [overlay],
  )

  const dismissOverlay = useCallback(() => setOverlay(null), [])

  return { breakDue, breakReason, overlay, loading, error, startBreak, snoozeBreak, completeBreak, dismissOverlay }
}
