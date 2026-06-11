'use client'

import { useMemo, useState } from 'react'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type { RecallOverlayContent } from '@/components/recall/useRecallBreak'

type Rating = 'got_it' | 'shaky' | 'forgot'

const TYPE_LABEL: Record<string, string> = {
  recall: 'Recall',
  connection: 'Connect',
  application: 'Apply',
}

const RATING_OPTIONS: Array<{ rating: Rating; label: string; icon: string }> = [
  { rating: 'got_it', label: 'Got it', icon: '✓' },
  { rating: 'shaky', label: 'Shaky', icon: '~' },
  { rating: 'forgot', label: 'Forgot', icon: '✕' },
]

// ── Recall Page ───────────────────────────────────────────────────────────────
// Three phases: summaries (what you covered) → one question at a time with
// reveal + self-rating → completion stats. Pure active retrieval: the answer
// stays hidden until the student commits to recalling it.

export function RecallBreakOverlay({
  content,
  onComplete,
  onDismiss,
}: {
  content: RecallOverlayContent
  onComplete: (ratings: Record<string, Rating>) => Promise<{ got_it: number; shaky: number; forgot: number; total: number } | null>
  onDismiss: () => void
}) {
  const [phase, setPhase] = useState<'summary' | 'questions' | 'done'>('summary')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [stats, setStats] = useState<{ got_it: number; shaky: number; forgot: number; total: number } | null>(null)
  const [finishing, setFinishing] = useState(false)

  const items = content.items
  const current = items[questionIndex] ?? null
  const progress = useMemo(
    () => (items.length ? Math.round(((questionIndex + (phase === 'done' ? 1 : 0)) / items.length) * 100) : 0),
    [questionIndex, items.length, phase],
  )

  async function rate(rating: Rating) {
    if (!current) return
    const nextRatings = { ...ratings, [current.id]: rating }
    setRatings(nextRatings)
    setRevealed(false)

    if (questionIndex + 1 < items.length) {
      setQuestionIndex((i) => i + 1)
      return
    }

    // Last question answered — submit.
    setFinishing(true)
    const result = await onComplete(nextRatings)
    setStats(result ?? {
      total: items.length,
      got_it: Object.values(nextRatings).filter((r) => r === 'got_it').length,
      shaky: Object.values(nextRatings).filter((r) => r === 'shaky').length,
      forgot: Object.values(nextRatings).filter((r) => r === 'forgot').length,
    })
    setFinishing(false)
    setPhase('done')
  }

  return (
    <div className="recall-overlay" role="dialog" aria-modal="true" aria-label="Recall break">
      <div className="recall-card">
        <header className="recall-header">
          <span className="recall-eyebrow">Recall break</span>
          <h2 className="recall-headline">{content.headline}</h2>
          {phase === 'questions' && items.length > 0 ? (
            <div className="recall-progress" aria-hidden="true">
              <span className="recall-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </header>

        {phase === 'summary' ? (
          <div className="recall-body">
            <p className="recall-intro">
              Quick pause. Here&apos;s what you just covered — skim it once, then answer from memory.
            </p>
            <div className="recall-summaries">
              {content.summaries.map((item) => (
                <div className="recall-summary-item" key={item.concept}>
                  <strong>{item.concept}</strong>
                  <MarkdownContent>{item.summary}</MarkdownContent>
                </div>
              ))}
            </div>
            <div className="recall-actions">
              <button className="button" type="button" onClick={() => setPhase('questions')}>
                Start recall · {items.length} question{items.length === 1 ? '' : 's'}
              </button>
              <button className="button-quiet" type="button" onClick={onDismiss}>
                Back to the lesson
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'questions' && current ? (
          <div className="recall-body">
            <div className="recall-question-meta">
              <span className={`recall-type recall-type-${current.type}`}>{TYPE_LABEL[current.type] ?? 'Recall'}</span>
              <span className="recall-count">
                {questionIndex + 1} / {items.length}
              </span>
            </div>
            <div className="recall-question">
              <MarkdownContent>{current.prompt}</MarkdownContent>
            </div>

            {!revealed ? (
              <div className="recall-actions">
                <button className="button" type="button" onClick={() => setRevealed(true)}>
                  Show answer
                </button>
                <span className="recall-hint">Answer in your head first — that&apos;s the part that builds memory.</span>
              </div>
            ) : (
              <>
                <div className="recall-answer">
                  <span className="recall-answer-label">Answer</span>
                  <MarkdownContent>{current.answer}</MarkdownContent>
                </div>
                <div className="recall-rating" role="group" aria-label="How did you do?">
                  <span className="recall-rating-label">How did you do?</span>
                  <div className="recall-rating-buttons">
                    {RATING_OPTIONS.map((option) => (
                      <button
                        key={option.rating}
                        className={`recall-rate-btn recall-rate-${option.rating}`}
                        type="button"
                        disabled={finishing}
                        onClick={() => rate(option.rating)}
                      >
                        <span aria-hidden="true">{option.icon}</span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="recall-body">
            <p className="recall-intro">Break done — that retrieval just made this material stick harder.</p>
            {stats ? (
              <div className="recall-stats">
                <div className="recall-stat recall-stat-got">
                  <strong>{stats.got_it}</strong>
                  <span>Got it</span>
                </div>
                <div className="recall-stat recall-stat-shaky">
                  <strong>{stats.shaky}</strong>
                  <span>Shaky</span>
                </div>
                <div className="recall-stat recall-stat-forgot">
                  <strong>{stats.forgot}</strong>
                  <span>Forgot</span>
                </div>
              </div>
            ) : null}
            {stats && stats.forgot + stats.shaky > 0 ? (
              <p className="recall-followup">
                The shaky ones are normal — they&apos;ll come back in your next quiz and reviews.
              </p>
            ) : null}
            <div className="recall-actions">
              <button className="button" type="button" onClick={onDismiss}>
                Continue learning
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Slim banner shown in the lesson when a break is due. */
export function RecallBreakBanner({
  reason,
  loading,
  onStart,
  onSnooze,
}: {
  reason: string | null
  loading: boolean
  onStart: () => void
  onSnooze: () => void
}) {
  return (
    <div className="recall-banner" role="status">
      <div className="recall-banner-text">
        <strong>Time for a quick recall break.</strong>
        <span>{reason ? `${reason} — a 3-minute recall locks it in.` : 'A 3-minute recall locks in what you just learned.'}</span>
      </div>
      <div className="recall-banner-actions">
        <button className="button" type="button" onClick={onStart} disabled={loading}>
          {loading ? 'Preparing…' : 'Start recall'}
        </button>
        <button className="button-quiet" type="button" onClick={onSnooze} disabled={loading}>
          5 more minutes
        </button>
      </div>
    </div>
  )
}
