'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconX,
  IconPlus,
  IconMinus,
  IconArrowsMaximize,
  IconArrowBackUp,
} from '@tabler/icons-react'

export interface ImageViewerSource {
  url: string
  alt?: string
  caption?: string
  figureLabel?: string
}

interface ImageViewerProps {
  source: ImageViewerSource
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const ZOOM_STEP = 0.4

/**
 * Fullscreen image viewer with zoom (wheel / buttons / keyboard), pan (drag),
 * pinch-to-zoom (touch), and keyboard navigation. Rendered in a portal so it
 * escapes any overflow/transform context that would clip it.
 */
export function ImageViewer({ source, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [mounted, setMounted] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomTo = useCallback((next: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    setScale(clamped)
    if (clamped <= 1) setOffset({ x: 0, y: 0 })
  }, [])

  // ── Keyboard ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomTo(scale + ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomTo(scale - ZOOM_STEP)
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [scale, zoomTo, reset, onClose])

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    zoomTo(scale + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))
  }

  // ── Mouse pan ──
  function onMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current) return
      setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) })
    }
    function onUp() { drag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Touch: pinch-to-zoom + one-finger pan ──
  function touchDist(t: React.TouchList) {
    const [a, b] = [t[0], t[1]]
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinch.current = { dist: touchDist(e.touches), scale }
    } else if (e.touches.length === 1 && scale > 1) {
      drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: offset.x, oy: offset.y }
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault()
      const ratio = touchDist(e.touches) / pinch.current.dist
      zoomTo(pinch.current.scale * ratio)
    } else if (e.touches.length === 1 && drag.current) {
      setOffset({
        x: drag.current.ox + (e.touches[0].clientX - drag.current.x),
        y: drag.current.oy + (e.touches[0].clientY - drag.current.y),
      })
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinch.current = null
    if (e.touches.length === 0) drag.current = null
  }

  function onDoubleClick() {
    if (scale > 1) reset()
    else zoomTo(2.5)
  }

  if (!mounted) return null

  const label = source.figureLabel || source.alt || 'Image'

  return createPortal(
    <div className="iv-overlay" role="dialog" aria-modal="true" aria-label={`${label} — image viewer`} onClick={onClose}>
      <div className="iv-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="iv-title">{label}</span>
        <div className="iv-actions">
          <button className="iv-btn" type="button" aria-label="Zoom out" onClick={() => zoomTo(scale - ZOOM_STEP)}>
            <IconMinus size={18} stroke={1.8} />
          </button>
          <span className="iv-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button className="iv-btn" type="button" aria-label="Zoom in" onClick={() => zoomTo(scale + ZOOM_STEP)}>
            <IconPlus size={18} stroke={1.8} />
          </button>
          <button className="iv-btn" type="button" aria-label="Reset zoom" onClick={reset}>
            <IconArrowBackUp size={18} stroke={1.8} />
          </button>
          <button className="iv-btn" type="button" aria-label="Fit to screen" onClick={reset}>
            <IconArrowsMaximize size={18} stroke={1.8} />
          </button>
          <button className="iv-btn iv-btn-close" type="button" aria-label="Close viewer" onClick={onClose}>
            <IconX size={18} stroke={1.8} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`iv-stage${scale > 1 ? ' zoomed' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="iv-img"
          src={source.url}
          alt={source.alt ?? label}
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>

      {source.caption && (
        <div className="iv-caption" onClick={(e) => e.stopPropagation()}>
          {source.figureLabel && <strong>{source.figureLabel}. </strong>}
          {source.caption}
        </div>
      )}
    </div>,
    document.body,
  )
}
