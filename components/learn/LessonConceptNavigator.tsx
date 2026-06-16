'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useRouter } from 'next/navigation'

export type LessonConceptNavPage = {
  id: string
  page_number: number
  concepts: string[]
  summary?: string | null
}

type Position = { x: number; y: number }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function storageKey(courseId: string, topicId: string) {
  return `trulurn:lesson-concept-nav:${courseId}:${topicId}`
}

export function LessonConceptNavigator({
  courseId,
  topicId,
  currentPageNumber,
  pages,
}: {
  courseId: string
  topicId: string
  currentPageNumber: number
  pages: LessonConceptNavPage[]
}) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef<Position>({ x: 18, y: 148 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPosition: Position
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [position, setPosition] = useState<Position>({ x: 18, y: 148 })
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)

  const entries = useMemo(() => {
    const rows = pages
      .filter((page) => page.concepts.length > 0)
      .flatMap((page) => page.concepts.slice(0, 5).map((concept) => ({
        id: `${page.id}:${concept}`,
        label: concept,
        pageNumber: page.page_number,
        summary: page.summary ?? null,
      })))
    const firstCurrent = rows.find((entry) => entry.pageNumber === currentPageNumber)
    return rows.map((entry) => ({
      ...entry,
      active: selectedEntryId ? entry.id === selectedEntryId : entry.id === firstCurrent?.id,
    }))
  }, [pages, currentPageNumber, selectedEntryId])

  useEffect(() => {
    setSelectedEntryId(null)
  }, [currentPageNumber])

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(courseId, topicId))
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<Position>
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        const next = { x: Number(parsed.x), y: Number(parsed.y) }
        positionRef.current = next
        setPosition(next)
      }
    } catch {
      // Ignore corrupt local placement and use the default left-side position.
    }
  }, [courseId, topicId])

  useEffect(() => {
    if (!rootRef.current) return
    const parent = rootRef.current.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    setPosition((current) => {
      const next = {
        x: clamp(current.x, 8, Math.max(8, rect.width - 48)),
        y: clamp(current.y, 56, Math.max(56, rect.height - 86)),
      }
      positionRef.current = next
      return next
    })
  }, [pages.length])

  if (entries.length <= 1) return null

  const panelOpensLeft = position.x > 260

  function persist(next: Position) {
    try {
      window.localStorage.setItem(storageKey(courseId, topicId), JSON.stringify(next))
    } catch {
      // Placement persistence is a convenience only.
    }
  }

  function clampToPanel(next: Position) {
    const parent = rootRef.current?.parentElement
    if (!parent) return next
    const rect = parent.getBoundingClientRect()
    return {
      x: clamp(next.x, 8, Math.max(8, rect.width - 48)),
      y: clamp(next.y, 56, Math.max(56, rect.height - 86)),
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      moved: false,
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true
      suppressClickRef.current = true
      setDragging(true)
    }
    if (!drag.moved) return

    const next = clampToPanel({
      x: drag.startPosition.x + dx,
      y: drag.startPosition.y + dy,
    })
    positionRef.current = next
    setPosition(next)
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    persist(positionRef.current)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }

  function handleHandleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setOpen((value) => !value)
  }

  function scrollToConceptInPage(label: string) {
    const lessonContent = document.querySelector('.lesson-content')
    if (!lessonContent) return

    const query = label.trim().toLowerCase()

    // Exact heading match first (strongest signal)
    const headings = lessonContent.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const el of headings) {
      if (el.textContent?.trim().toLowerCase() === query) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }

    // Exact strong/bold match (concepts often appear as bold defined terms)
    const strongs = lessonContent.querySelectorAll('strong, b, dt')
    for (const el of strongs) {
      if (el.textContent?.trim().toLowerCase() === query) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }

    // Partial heading match as fallback (catches "algorithm vs program…" style titles)
    for (const el of headings) {
      const text = el.textContent?.trim().toLowerCase() ?? ''
      if (text.includes(query) || query.includes(text)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
  }

  function goToEntry(entry: { id: string; pageNumber: number; label: string }) {
    setSelectedEntryId(entry.id)
    setOpen(false)
    if (entry.pageNumber === currentPageNumber) {
      scrollToConceptInPage(entry.label)
      return
    }
    router.push(`/learn/${encodeURIComponent(courseId)}/${encodeURIComponent(topicId)}?page=${entry.pageNumber}`)
  }

  return (
    <div
      ref={rootRef}
      className={[
        'lesson-concept-nav',
        open ? 'is-open' : '',
        dragging ? 'is-dragging' : '',
        panelOpensLeft ? 'opens-left' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: position.x, top: position.y }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        className="lcn-handle"
        type="button"
        aria-label="Open concept navigator"
        title="Drag or hover to navigate concepts"
        onClick={handleHandleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <span className="lcn-handle-dot" />
        <span className="lcn-handle-dot" />
        <span className="lcn-handle-dot" />
      </button>

      <nav className="lcn-panel" aria-label="Lesson concept navigation">
        <div className="lcn-head">
          <span>Concepts</span>
          <small>Drag the circle</small>
        </div>
        <div className="lcn-list">
          {entries.map((entry) => (
            <button
              key={entry.id}
              className={entry.active ? 'lcn-item active' : 'lcn-item'}
              type="button"
              onClick={() => goToEntry(entry)}
              aria-current={entry.active ? 'page' : undefined}
            >
              <span className="lcn-page">P{entry.pageNumber}</span>
              <span className="lcn-copy">
                <strong>{entry.label}</strong>
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
