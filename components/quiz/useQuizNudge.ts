'use client'

import { useEffect, useState } from 'react'

// Balanced-mode courses nudge toward a quiz once this many completed topics
// have piled up with no quiz attempt at all.
const MILESTONE = 3

export type QuizNudgeData = {
  unquizzedCount: number
  topicId: string
  topicTitle: string
}

function ackKey(courseId: string) {
  return `trulurn-quiz-nudge-ack:${courseId}`
}

function readAck(courseId: string) {
  if (typeof window === 'undefined') return 0
  const value = Number(window.localStorage.getItem(ackKey(courseId)))
  return Number.isFinite(value) ? value : 0
}

/**
 * Tracks whether the balanced-mode quiz nudge should be active. The server
 * computes how many completed topics have no quiz attempt at all; this hook
 * turns that into a repeating milestone (every 3 more unquizzed topics) and
 * remembers dismissals per course in localStorage so it doesn't re-fire on
 * every navigation.
 */
export function useQuizNudge({
  courseId,
  learningControl,
  quizNudge,
}: {
  courseId: string
  learningControl?: string
  quizNudge?: QuizNudgeData | null
}) {
  const [ack, setAck] = useState(0)

  useEffect(() => {
    setAck(readAck(courseId))
  }, [courseId])

  const eligible = learningControl === 'balanced' && Boolean(quizNudge)
  const active = eligible && quizNudge!.unquizzedCount - ack >= MILESTONE

  function dismiss() {
    if (!quizNudge) return
    window.localStorage.setItem(ackKey(courseId), String(quizNudge.unquizzedCount))
    setAck(quizNudge.unquizzedCount)
  }

  return {
    active,
    topicId: quizNudge?.topicId ?? null,
    topicTitle: quizNudge?.topicTitle ?? null,
    dismiss,
  }
}
