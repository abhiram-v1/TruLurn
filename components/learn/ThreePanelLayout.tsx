'use client'

import { useEffect, useRef, useState } from 'react'

export function ThreePanelLayout({
  left,
  middle,
  right,
  roadmapCollapsed = false,
  doubtsExpanded = false,
  lessonPanelRef,
}: {
  left: React.ReactNode
  middle: React.ReactNode
  right: React.ReactNode
  roadmapCollapsed?: boolean
  doubtsExpanded?: boolean
  lessonPanelRef?: React.RefObject<HTMLElement | null>
}) {
  const [chatWidth, setChatWidth] = useState<number | null>(null)
  const isDraggingRef = useRef(false)

  // Reset custom width when doubtsExpanded state changes, so it snaps to default widths
  useEffect(() => {
    setChatWidth(null)
  }, [doubtsExpanded])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true

    const chatPanel = document.querySelector('.chat-panel')
    const startWidth = chatPanel ? chatPanel.getBoundingClientRect().width : 360
    const startX = e.clientX

    const shell = document.querySelector('.learn-shell') as HTMLElement
    if (shell) {
      shell.style.transition = 'none'
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const deltaX = startX - moveEvent.clientX
      // Clamp width between 260px and 800px
      const newWidth = Math.max(260, Math.min(800, startWidth + deltaX))
      setChatWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      if (shell) {
        shell.style.transition = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const gridStyle = chatWidth !== null
    ? {
        gridTemplateColumns: roadmapCollapsed
          ? `64px 1fr ${chatWidth}px`
          : `clamp(360px, 28vw, 420px) 1fr ${chatWidth}px`
      }
    : undefined

  return (
    <main
      className={[
        'learn-shell',
        roadmapCollapsed ? 'roadmap-collapsed' : '',
        doubtsExpanded ? 'doubts-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={gridStyle}
    >
      <aside className="roadmap-panel">{left}</aside>
      <section className="lesson-panel" ref={lessonPanelRef as React.RefObject<HTMLElement>}>{middle}</section>
      <aside className="chat-panel" style={{ position: 'relative' }}>
        <div className="chat-resizer" onMouseDown={handleMouseDown} />
        {right}
      </aside>
    </main>
  )
}
