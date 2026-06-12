'use client'

import {
  IconBell,
  IconCheck,
  IconClock,
  IconCoffee,
  IconPlayerPlay,
  IconTag,
  IconX,
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type {
  RecallOverlayContent,
  RecallRestState,
} from '@/components/recall/useRecallBreak'

const TYPE_LABEL: Record<string, string> = {
  recall: 'Recall',
  connection: 'Connect',
  application: 'Apply',
}

export function RecallBreakCountdown({ rest }: { rest: RecallRestState }) {
  const minutes = Math.floor(rest.remainingSeconds / 60)
  const seconds = rest.remainingSeconds % 60
  const totalSeconds = Math.max(1, rest.durationMinutes * 60)
  const progress = Math.max(0, Math.min(100, ((totalSeconds - rest.remainingSeconds) / totalSeconds) * 100))

  return (
    <div className="recall-overlay" role="dialog" aria-modal="true" aria-label="Break countdown">
      <div className="recall-card recall-rest-card">
        <div className="recall-rest-icon" aria-hidden="true">
          <IconCoffee size={30} stroke={1.6} />
        </div>
        <span className="recall-eyebrow">Protected break</span>
        <h2 className="recall-rest-title">Step away for a moment</h2>
        <p className="recall-intro">
          Your lesson is paused. TruLurn is preparing a few memory cues quietly in the background.
        </p>
        <div
          className="recall-countdown"
          style={{ '--break-progress': `${progress * 3.6}deg` } as React.CSSProperties}
          aria-label={`${minutes} minutes and ${seconds} seconds remaining`}
        >
          <div className="recall-countdown-inner">
            <strong>{minutes}:{String(seconds).padStart(2, '0')}</strong>
            <span>remaining</span>
          </div>
        </div>
        <div className={`recall-preparation-state ${rest.promptsPrepared ? 'ready' : ''}`} role="status">
          {rest.waitingForPrompts
            ? 'Break complete. Finishing your recall prompts...'
            : rest.promptsPrepared
              ? 'Recall prompts are ready for your return.'
              : 'Preparing recall prompts during your break...'}
        </div>
      </div>
    </div>
  )
}

export function RecallBreakOverlay({
  content,
  onComplete,
  onTag,
  onDismiss,
}: {
  content: RecallOverlayContent
  onComplete: (reviewedItemIds: string[]) => Promise<{ reviewed: number } | null>
  onTag: (itemId: string) => Promise<boolean>
  onDismiss: () => void
}) {
  const [phase, setPhase] = useState<'questions' | 'done'>('questions')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [taggedItemIds, setTaggedItemIds] = useState(
    () => new Set(content.items.filter((item) => item.tagged).map((item) => item.id)),
  )
  const [taggingItemId, setTaggingItemId] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = content.items
  const current = items[questionIndex] ?? null
  const progress = useMemo(
    () => (items.length ? Math.round(((questionIndex + 1) / items.length) * 100) : 0),
    [questionIndex, items.length],
  )

  async function tagCurrent() {
    if (!current || taggedItemIds.has(current.id) || taggingItemId) return
    setTaggingItemId(current.id)
    setError(null)
    const saved = await onTag(current.id)
    if (saved) {
      setTaggedItemIds((existing) => new Set(existing).add(current.id))
    } else {
      setError('Could not tag this reminder. Please try again.')
    }
    setTaggingItemId(null)
  }

  async function advance() {
    if (!current || finishing) return
    setError(null)

    if (questionIndex + 1 < items.length) {
      setQuestionIndex((index) => index + 1)
      return
    }

    setFinishing(true)
    const reviewedItemIds = items.slice(0, questionIndex + 1).map((item) => item.id)
    const result = await onComplete(reviewedItemIds)
    setFinishing(false)
    if (!result) {
      setError('Could not finish this recall break. Please try once more.')
      return
    }
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

        {phase === 'questions' && current ? (
          <div className="recall-body">
            <p className="recall-intro">
              Pause for a moment and bring the idea back from memory. Nothing needs to be typed or submitted.
            </p>
            <div className="recall-question-meta">
              <span className={`recall-type recall-type-${current.type}`}>{TYPE_LABEL[current.type] ?? 'Recall'}</span>
              <span className="recall-count">
                {questionIndex + 1} / {items.length}
              </span>
            </div>
            <div className="recall-question">
              <MarkdownContent>{current.prompt}</MarkdownContent>
            </div>

            <div className="recall-prompt-actions">
              <button
                className={`recall-tag-btn ${taggedItemIds.has(current.id) ? 'tagged' : ''}`}
                type="button"
                disabled={taggedItemIds.has(current.id) || taggingItemId === current.id}
                onClick={tagCurrent}
              >
                {taggedItemIds.has(current.id) ? (
                  <IconCheck aria-hidden="true" size={15} stroke={2} />
                ) : (
                  <IconTag aria-hidden="true" size={15} stroke={1.8} />
                )}
                {taggedItemIds.has(current.id)
                  ? 'Tagged for later'
                  : taggingItemId === current.id
                    ? 'Tagging...'
                    : 'Tag'}
              </button>
              <span className="recall-hint">Tag it when the idea does not come back clearly.</span>
            </div>

            {error ? <p className="recall-action-error" role="alert">{error}</p> : null}

            <div className="recall-actions recall-actions-spread">
              <button className="button-quiet" type="button" onClick={onDismiss}>
                Return to lesson
              </button>
              <button className="button" type="button" onClick={advance} disabled={finishing}>
                {finishing
                  ? 'Saving...'
                  : questionIndex + 1 < items.length
                    ? 'Next prompt'
                    : 'Finish review'}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="recall-body">
            <p className="recall-intro">
              Review complete. Any prompts you tagged are waiting inside Traccia, ready to take you back to the source.
            </p>
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
  durationMinutes,
  loading,
  onStart,
  onSnooze,
  onSkip,
}: {
  reason: string | null
  durationMinutes: number
  loading: boolean
  onStart: () => void
  onSnooze: (minutes: number) => void
  onSkip: () => void
}) {
  const [showReminderOptions, setShowReminderOptions] = useState(false)
  const [customMinutes, setCustomMinutes] = useState(10)

  return (
    <div className="recall-banner" role="dialog" aria-label="Break suggestion">
      <div className="recall-banner-text">
        <strong>A good break point is nearby.</strong>
        <span>
          {reason ? `${reason}. ` : ''}
          Take a {durationMinutes}-minute break now, or keep your focus and ask again later.
        </span>
      </div>
      <div className="recall-banner-actions">
        <button className="button" type="button" onClick={onStart} disabled={loading}>
          <IconPlayerPlay aria-hidden="true" size={15} stroke={2} />
          Start break
        </button>
        <button
          className="button-quiet"
          type="button"
          onClick={() => setShowReminderOptions((visible) => !visible)}
          disabled={loading}
          aria-expanded={showReminderOptions}
        >
          <IconBell aria-hidden="true" size={15} stroke={1.8} />
          Remind me later
        </button>
        <button className="button-quiet recall-skip-btn" type="button" onClick={onSkip} disabled={loading}>
          <IconX aria-hidden="true" size={15} stroke={1.8} />
          Skip for now
        </button>
      </div>
      {showReminderOptions ? (
        <div className="recall-reminder-options">
          <span className="recall-reminder-label">
            <IconClock aria-hidden="true" size={14} stroke={1.8} />
            Remind me in
          </span>
          {[5, 10, 15].map((minutes) => (
            <button key={minutes} type="button" onClick={() => onSnooze(minutes)}>
              {minutes} min
            </button>
          ))}
          <label className="recall-custom-delay">
            <input
              type="number"
              min={1}
              max={120}
              value={customMinutes}
              onChange={(event) => setCustomMinutes(Math.min(120, Math.max(1, Number(event.target.value) || 1)))}
              aria-label="Custom reminder delay in minutes"
            />
            <span>min</span>
          </label>
          <button type="button" onClick={() => onSnooze(customMinutes)}>Set</button>
        </div>
      ) : null}
    </div>
  )
}
