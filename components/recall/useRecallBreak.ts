'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const HEARTBEAT_MS = 60_000
const ENGAGEMENT_CHECK_MS = 5_000
const QUIET_WINDOW_MS = 45_000
const HIGH_ENGAGEMENT_WINDOW_MS = 12_000
const MAX_SUGGESTION_DEFERRAL_MS = 8 * 60_000
const MIN_AI_CLASSIFICATION_GAP_MS = 30_000
const BREAK_STORAGE_PREFIX = 'trulurn-active-break:'

export type RecallOverlayItem = {
  id: string
  type: 'recall' | 'connection' | 'application'
  concept: string
  prompt: string
  topicId: string | null
  topicTitle: string | null
  pageNumber: number | null
  tagged: boolean
}

export type RecallOverlayContent = {
  id: string
  headline: string
  summaries: Array<{ concept: string; summary: string }>
  items: RecallOverlayItem[]
}

export type RecallRestState = {
  durationMinutes: number
  endsAt: number
  remainingSeconds: number
  promptsPrepared: boolean
  waitingForPrompts: boolean
}

export type RecallBreakState = {
  breakDue: boolean
  breakReason: string | null
  breakDurationMinutes: number
  rest: RecallRestState | null
  overlay: RecallOverlayContent | null
  loading: boolean
  error: string | null
  startBreak: (manual?: boolean) => void
  snoozeBreak: (minutes: number) => void
  skipBreak: () => void
  completeBreak: (reviewedItemIds: string[]) => Promise<{ reviewed: number } | null>
  tagReminder: (itemId: string) => Promise<boolean>
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
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(10)
  const [rest, setRest] = useState<RecallRestState | null>(null)
  const [overlay, setOverlay] = useState<RecallOverlayContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendingReasonRef = useRef<string | null>(null)
  const pendingSinceRef = useRef<number | null>(null)
  const snoozedUntilRef = useRef(0)
  const lastInteractionRef = useRef(Date.now())
  const recentInteractionsRef = useRef<number[]>([])
  const startingRef = useRef(false)
  const preparedRecallRef = useRef<RecallOverlayContent | null>(null)
  const restEndsAtRef = useRef<number | null>(null)
  const currentLocationRef = useRef(`${topicId}:${pageNumber}`)
  const classificationInFlightRef = useRef(false)
  const lastClassificationAtRef = useRef(0)
  const nextClassificationAtRef = useRef(0)

  useEffect(() => {
    fetch('/api/settings/recall')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const duration = Number(data?.durationMinutes)
        if (Number.isFinite(duration)) {
          setBreakDurationMinutes(Math.min(45, Math.max(5, Math.round(duration))))
        }
      })
      .catch(() => {})
  }, [])

  const clearPendingSuggestion = useCallback(() => {
    pendingReasonRef.current = null
    pendingSinceRef.current = null
    nextClassificationAtRef.current = 0
    setBreakDue(false)
    setBreakReason(null)
  }, [])

  const showSuggestion = useCallback(() => {
    if (!pendingSinceRef.current || Date.now() < snoozedUntilRef.current) return
    setBreakReason(pendingReasonRef.current)
    setBreakDue(true)
  }, [])

  const requestAIInterruptionDecision = useCallback(async ({
    naturalPoint,
    idleFor,
    pendingFor,
    interactionsLast30Seconds,
  }: {
    naturalPoint: boolean
    idleFor: number
    pendingFor: number
    interactionsLast30Seconds: number
  }) => {
    const now = Date.now()
    if (
      classificationInFlightRef.current
      || now < nextClassificationAtRef.current
      || now - lastClassificationAtRef.current < MIN_AI_CLASSIFICATION_GAP_MS
    ) return

    classificationInFlightRef.current = true
    lastClassificationAtRef.current = now

    try {
      const response = await fetch('/api/recall/interruption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          topicTitle,
          pageNumber,
          reason: pendingReasonRef.current,
          naturalPoint,
          idleSeconds: Math.round(idleFor / 1000),
          interactionsLast30Seconds,
          pendingSeconds: Math.round(pendingFor / 1000),
          tabVisible: document.visibilityState === 'visible',
        }),
      })

      if (!response.ok) {
        nextClassificationAtRef.current = Date.now() + 60_000
        return
      }

      const data = await response.json()
      if (data.decision === 'show_now') {
        showSuggestion()
        return
      }

      const deferSeconds = Math.min(180, Math.max(20, Number(data.deferSeconds) || 60))
      nextClassificationAtRef.current = Date.now() + deferSeconds * 1000
    } catch {
      nextClassificationAtRef.current = Date.now() + 60_000
    } finally {
      classificationInFlightRef.current = false
    }
  }, [courseId, pageNumber, showSuggestion, topicTitle])

  const considerSuggestion = useCallback((naturalPoint = false) => {
    if (!pendingSinceRef.current || Date.now() < snoozedUntilRef.current || rest || overlay) return

    const now = Date.now()
    const idleFor = now - lastInteractionRef.current
    recentInteractionsRef.current = recentInteractionsRef.current.filter((time) => now - time < 30_000)
    const interactionBurst = recentInteractionsRef.current.length >= 6
    const highlyEngaged = idleFor < HIGH_ENGAGEMENT_WINDOW_MS || interactionBurst
    const pendingFor = now - pendingSinceRef.current

    // Deterministic safety rails handle obvious cases. AI is reserved for
    // ambiguous transitions so this never becomes a model call per interaction.
    if (idleFor >= QUIET_WINDOW_MS || pendingFor >= MAX_SUGGESTION_DEFERRAL_MS) {
      showSuggestion()
      return
    }

    if (naturalPoint || (!highlyEngaged && idleFor >= 18_000)) {
      void requestAIInterruptionDecision({
        naturalPoint,
        idleFor,
        pendingFor,
        interactionsLast30Seconds: recentInteractionsRef.current.length,
      })
    }
  }, [overlay, requestAIInterruptionDecision, rest, showSuggestion])

  // The local model tracks coarse activity. The selected provider sees only a bounded snapshot
  // when the timing is ambiguous; it never receives lesson or conversation text.
  useEffect(() => {
    let lastScrollSignal = 0
    const recordInteraction = (event: Event) => {
      const now = Date.now()
      if (event.type === 'scroll' && now - lastScrollSignal < 800) return
      if (event.type === 'scroll') lastScrollSignal = now
      lastInteractionRef.current = now
      recentInteractionsRef.current.push(now)
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll']
    events.forEach((event) => window.addEventListener(event, recordInteraction, { passive: true }))
    const interval = window.setInterval(() => considerSuggestion(false), ENGAGEMENT_CHECK_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') considerSuggestion(false)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      events.forEach((event) => window.removeEventListener(event, recordInteraction))
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [considerSuggestion])

  const registerPendingBreak = useCallback((reason: string | null, naturalPoint: boolean) => {
    if (!pendingSinceRef.current) pendingSinceRef.current = Date.now()
    pendingReasonRef.current = reason
    window.setTimeout(() => considerSuggestion(naturalPoint), naturalPoint ? 1200 : 0)
  }, [considerSuggestion])

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
          const nextLocation = `${topicId}:${pageNumber}`
          registerPendingBreak(
            typeof data.reason === 'string' ? data.reason : null,
            event === 'page_view' && currentLocationRef.current !== nextLocation,
          )
        }
      } catch {
        // Tracking is best-effort and must never disturb the lesson.
      } finally {
        currentLocationRef.current = `${topicId}:${pageNumber}`
      }
    },
    [courseId, topicId, topicTitle, pageNumber, keyConcepts, pageSummary, registerPendingBreak],
  )

  useEffect(() => {
    void track('page_view')
    // Page boundaries are natural reconsideration points for a pending break.
    considerSuggestion(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, topicId, pageNumber])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || rest || overlay) return
      void track('heartbeat')
    }, HEARTBEAT_MS)
    return () => window.clearInterval(interval)
  }, [track, rest, overlay])

  const revealPreparedRecall = useCallback(() => {
    const prepared = preparedRecallRef.current
    if (!prepared) {
      setRest((current) => current ? { ...current, remainingSeconds: 0, waitingForPrompts: true } : current)
      return
    }

    sessionStorage.removeItem(`${BREAK_STORAGE_PREFIX}${courseId}`)
    setRest(null)
    setOverlay(prepared)
    preparedRecallRef.current = null
    restEndsAtRef.current = null
  }, [courseId])

  const activeRestEndsAt = rest?.endsAt ?? null

  useEffect(() => {
    if (!activeRestEndsAt) return
    const endsAt = activeRestEndsAt
    const tick = () => {
      const remainingSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRest((current) => current ? { ...current, remainingSeconds } : current)
      if (remainingSeconds <= 0) revealPreparedRecall()
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [activeRestEndsAt, revealPreparedRecall])

  const prepareRecall = useCallback(async (manual: boolean) => {
    try {
      const res = await fetch('/api/recall/break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, action: 'start', manual }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not prepare the recall prompts.')
        if (res.status === 409) clearPendingSuggestion()
        sessionStorage.removeItem(`${BREAK_STORAGE_PREFIX}${courseId}`)
        restEndsAtRef.current = null
        setRest(null)
        return
      }

      preparedRecallRef.current = data.recall as RecallOverlayContent
      setRest((current) => current ? { ...current, promptsPrepared: true } : current)
      if (restEndsAtRef.current && Date.now() >= restEndsAtRef.current) revealPreparedRecall()
    } catch {
      setError('Could not prepare the recall prompts.')
      sessionStorage.removeItem(`${BREAK_STORAGE_PREFIX}${courseId}`)
      restEndsAtRef.current = null
      setRest(null)
    } finally {
      startingRef.current = false
      setLoading(false)
    }
  }, [clearPendingSuggestion, courseId, revealPreparedRecall])

  const startBreak = useCallback(
    (manual = false) => {
      if (startingRef.current || rest || overlay) return
      startingRef.current = true
      setLoading(true)
      setError(null)
      clearPendingSuggestion()

      const endsAt = Date.now() + breakDurationMinutes * 60_000
      restEndsAtRef.current = endsAt
      setRest({
        durationMinutes: breakDurationMinutes,
        endsAt,
        remainingSeconds: breakDurationMinutes * 60,
        promptsPrepared: false,
        waitingForPrompts: false,
      })
      sessionStorage.setItem(
        `${BREAK_STORAGE_PREFIX}${courseId}`,
        JSON.stringify({ endsAt, durationMinutes: breakDurationMinutes }),
      )
      void prepareRecall(manual)
    },
    [breakDurationMinutes, clearPendingSuggestion, courseId, overlay, prepareRecall, rest],
  )

  // Restore an active countdown after a refresh. The server reuses the open
  // recall session, so preparing again is cheap and deterministic.
  useEffect(() => {
    if (rest || overlay || startingRef.current) return
    try {
      const stored = JSON.parse(sessionStorage.getItem(`${BREAK_STORAGE_PREFIX}${courseId}`) ?? 'null')
      if (!stored?.endsAt || !stored?.durationMinutes) return
      const endsAt = Number(stored.endsAt)
      const durationMinutes = Number(stored.durationMinutes)
      if (!Number.isFinite(endsAt) || !Number.isFinite(durationMinutes)) return

      startingRef.current = true
      restEndsAtRef.current = endsAt
      setRest({
        durationMinutes,
        endsAt,
        remainingSeconds: Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)),
        promptsPrepared: false,
        waitingForPrompts: endsAt <= Date.now(),
      })
      void prepareRecall(false)
    } catch {
      sessionStorage.removeItem(`${BREAK_STORAGE_PREFIX}${courseId}`)
    }
  }, [courseId, overlay, prepareRecall, rest])

  const deferBreak = useCallback((action: 'snooze' | 'skip', minutes: number) => {
    const boundedMinutes = Math.min(120, Math.max(1, Math.round(minutes)))
    snoozedUntilRef.current = Date.now() + boundedMinutes * 60_000
    clearPendingSuggestion()
    fetch('/api/recall/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, action, minutes: boundedMinutes }),
    }).catch(() => {})
  }, [clearPendingSuggestion, courseId])

  const snoozeBreak = useCallback((minutes: number) => {
    deferBreak('snooze', minutes)
  }, [deferBreak])

  const skipBreak = useCallback(() => {
    deferBreak('skip', 20)
  }, [deferBreak])

  const completeBreak = useCallback(
    async (reviewedItemIds: string[]) => {
      if (!overlay) return null
      try {
        const res = await fetch('/api/recall/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recallSessionId: overlay.id, reviewedItemIds }),
        })
        if (!res.ok) return null
        const data = await res.json()
        return { reviewed: Number(data.reviewed ?? reviewedItemIds.length) }
      } catch {
        return null
      }
    },
    [overlay],
  )

  const tagReminder = useCallback(
    async (itemId: string) => {
      if (!overlay) return false
      try {
        const res = await fetch('/api/recall/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recallSessionId: overlay.id, itemId }),
        })
        const data = await res.json()
        if (!res.ok) return false

        setOverlay((current) => current
          ? {
              ...current,
              items: current.items.map((item) => item.id === itemId ? { ...item, tagged: true } : item),
            }
          : current)
        if (data.reminder) {
          window.dispatchEvent(new CustomEvent('trulurn:tagged-reminder', { detail: data.reminder }))
        }
        return true
      } catch {
        return false
      }
    },
    [overlay],
  )

  const dismissOverlay = useCallback(() => setOverlay(null), [])

  return {
    breakDue,
    breakReason,
    breakDurationMinutes,
    rest,
    overlay,
    loading,
    error,
    startBreak,
    snoozeBreak,
    skipBreak,
    completeBreak,
    tagReminder,
    dismissOverlay,
  }
}
