'use client'

import Link from 'next/link'
import { IconBrain, IconX } from '@tabler/icons-react'

export function QuizInviteBanner({
  topicTitle,
  quizHref,
  onDismiss,
}: {
  topicTitle: string
  quizHref: string
  onDismiss: () => void
}) {
  return (
    <div className="quiz-invite-banner" role="complementary" aria-label="Quiz suggestion">
      <div className="quiz-invite-icon" aria-hidden="true">
        <IconBrain size={18} stroke={1.7} />
      </div>
      <div className="quiz-invite-text">
        <strong>You&apos;ve finished {topicTitle}.</strong>
        <span>A short check-in locks in what you learned and shows where gaps are while it&apos;s still fresh.</span>
      </div>
      <div className="quiz-invite-actions">
        <Link className="button" href={quizHref} prefetch={false}>
          Take quiz
        </Link>
        <button className="button-quiet quiz-invite-dismiss" type="button" onClick={onDismiss}>
          <IconX aria-hidden="true" size={13} stroke={2} />
          Maybe later
        </button>
      </div>
    </div>
  )
}
