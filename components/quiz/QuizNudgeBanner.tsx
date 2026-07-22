'use client'

import Link from 'next/link'
import { IconBrain, IconX } from '@tabler/icons-react'

export function QuizNudgeBanner({
  topicTitle,
  quizHref,
  onDismiss,
}: {
  topicTitle: string
  quizHref: string
  onDismiss: () => void
}) {
  return (
    <div className="quiz-nudge-banner" role="dialog" aria-label="Quiz suggestion">
      <div className="quiz-nudge-icon" aria-hidden="true">
        <IconBrain size={18} stroke={1.7} />
      </div>
      <div className="quiz-nudge-text">
        <strong>A few topics have gone unchecked.</strong>
        <span>A quick quiz on {topicTitle} confirms it stuck before you move on to the next topic.</span>
      </div>
      <div className="quiz-nudge-actions">
        <Link className="button" href={quizHref} prefetch={false}>
          Take quiz
        </Link>
        <button className="button-quiet quiz-nudge-dismiss" type="button" onClick={onDismiss}>
          <IconX aria-hidden="true" size={13} stroke={2} />
          Dismiss for now
        </button>
      </div>
    </div>
  )
}
