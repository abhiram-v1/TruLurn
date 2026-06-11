'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type DueReview = {
  id: string
  course_id: string
  course_title: string
  topic_id: string
  topic_title: string
  due_at: string
  interval_index: number
  review_count: number
  overdue_days: number
}

// Spaced-repetition surface. Shows topics whose retrieval review is due, so the
// student keeps what they've mastered instead of riding the forgetting curve.
// Scoped to one course when `courseId` is passed, otherwise account-wide.
export function ReviewsDuePanel({ courseId }: { courseId?: string }) {
  const [reviews, setReviews] = useState<DueReview[] | null>(null)

  useEffect(() => {
    let alive = true
    const url = courseId ? `/api/reviews?courseId=${encodeURIComponent(courseId)}` : '/api/reviews'
    fetch(url)
      .then((res) => (res.ok ? res.json() : { reviews: [] }))
      .then((data) => {
        if (alive) setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      })
      .catch(() => {
        if (alive) setReviews([])
      })
    return () => {
      alive = false
    }
  }, [courseId])

  // Render nothing until loaded, and nothing when there's nothing due — this panel
  // should never add visual noise on a course with no pending reviews.
  if (!reviews || reviews.length === 0) return null

  return (
    <section className="reviews-due-panel" aria-label="Reviews due">
      <div className="reviews-due-header">
        <span className="reviews-due-title">
          {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'} due
        </span>
        <span className="reviews-due-sub">Quick retrieval checks keep mastered topics from fading.</span>
      </div>
      <ul className="reviews-due-list">
        {reviews.slice(0, 6).map((review) => (
          <li key={review.id} className="reviews-due-item">
            <div className="reviews-due-item-main">
              <span className="reviews-due-topic">{review.topic_title}</span>
              {!courseId ? (
                <span className="reviews-due-course">{review.course_title}</span>
              ) : null}
              <span className="reviews-due-meta">
                {review.review_count === 0
                  ? 'First review'
                  : `Review ${review.review_count + 1}`}
                {review.overdue_days > 0
                  ? ` · ${review.overdue_days}d overdue`
                  : ' · due today'}
              </span>
            </div>
            <Link
              className="button-subtle reviews-due-action"
              href={`/quiz/${encodeURIComponent(review.topic_id)}?review=1`}
            >
              Review now →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
