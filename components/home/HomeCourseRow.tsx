'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react'
import { TopicPill } from '@/components/ui/TopicPill'

type HomeCourseRowProps = {
  courseId: string
  title: string
  meta: string
  status: 'active' | 'partial'
}

type MenuPosition = {
  x: number
  y: number
}

export function HomeCourseRow({ courseId, title, meta, status }: HomeCourseRowProps) {
  const router = useRouter()
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!menuPosition) return

    function closeMenu() {
      setMenuPosition(null)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuPosition])

  async function deleteCourse() {
    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Could not delete this course.')
      }

      setConfirmOpen(false)
      router.refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this course.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Link
        className="home-course-row"
        href={`/course/${courseId}`}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuPosition({
            x: Math.min(event.clientX, window.innerWidth - 190),
            y: Math.min(event.clientY, window.innerHeight - 64),
          })
        }}
      >
        <span className={`state-dot ${status}`} />
        <span className="home-course-copy">
          <span className="course-title">{title}</span>
          <span className="course-meta">{meta}</span>
        </span>
        <TopicPill state={status} />
      </Link>

      {menuPosition ? (
        <div
          className="course-context-menu"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
          aria-label={`${title} actions`}
        >
          <button
            className="course-menu-item danger"
            onClick={() => {
              setMenuPosition(null)
              setConfirmOpen(true)
            }}
            role="menuitem"
            type="button"
          >
            <IconTrash size={16} stroke={1.8} />
            <span>Delete course</span>
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="delete-confirm-backdrop" role="presentation">
          <div
            className="delete-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-${courseId}-title`}
          >
            <div className="delete-confirm-icon" aria-hidden="true">
              <IconAlertTriangle size={20} stroke={1.8} />
            </div>
            <div className="delete-confirm-copy">
              <h2 id={`delete-${courseId}-title`}>Delete this course?</h2>
              <p>
                This will permanently delete the Atlas, lesson pages, summaries, doubts,
                quiz attempts, and memory for this course. This cannot be retrieved again.
              </p>
              {error ? <p className="delete-confirm-error">{error}</p> : null}
            </div>
            <div className="delete-confirm-actions">
              <button
                className="button-subtle"
                disabled={isDeleting}
                onClick={() => setConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button-danger"
                disabled={isDeleting}
                onClick={deleteCourse}
                type="button"
              >
                {isDeleting ? 'Deleting...' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
