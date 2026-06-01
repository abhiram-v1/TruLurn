'use client'

import { IconBulb, IconListDetails, IconMessageCircle, IconRefresh, IconSparkles, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

export type TransformAction = 'simplify' | 'deeper' | 'example'

type SelectionInfo = {
  text: string
  sectionIdx: number   // -1 for legacy .lesson-body pages
  x: number
  above: number
}

type ToolbarState =
  | { phase: 'idle' }
  | { phase: 'ready';   sel: SelectionInfo }
  | { phase: 'loading'; sel: SelectionInfo; action: TransformAction }
  | { phase: 'error';   sel: SelectionInfo; action: TransformAction; message: string }

const LABELS: Record<TransformAction, string> = {
  simplify: 'Simplify',
  deeper:   'Go Deeper',
  example:  'Example',
}

export function LessonSelectionToolbar({
  topicId,
  courseId,
  topicTitle,
  onTransformComplete,
  onAttachToChat,
}: {
  topicId: string
  courseId: string
  topicTitle: string
  /** Called when the AI returns a result. The caller applies it inline. */
  onTransformComplete: (sectionIdx: number, selectedText: string, result: string, action: TransformAction) => void
  onAttachToChat?: (selectedText: string) => void
}) {
  const [state, setState] = useState<ToolbarState>({ phase: 'idle' })
  // Ref so the selection-detection closure always reads the latest phase
  // without stale-closure issues or unnecessary effect re-registrations.
  const phaseRef = useRef<ToolbarState['phase']>('idle')

  function set(next: ToolbarState) {
    phaseRef.current = next.phase
    setState(next)
  }

  // ── Selection detection ───────────────────────────────────────────────────
  useEffect(() => {
    function capture() {
      // Never interrupt an in-flight or error state
      if (phaseRef.current === 'loading' || phaseRef.current === 'error') return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        set({ phase: 'idle' })
        return
      }
      const text = selection.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 5) { set({ phase: 'idle' }); return }

      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (!el?.closest('.lesson-body, .lesson-sections')) { set({ phase: 'idle' }); return }

      // Which section is this text in? (structured pages only)
      const sectionEl = el.closest('[data-section-index]')
      const sectionIdx = sectionEl ? parseInt(sectionEl.getAttribute('data-section-index') ?? '-1') : -1

      const rect = range.getBoundingClientRect()
      const fr = range.getClientRects()[0]
      const r = (rect.width || rect.height) ? rect : fr
      if (!r) return

      set({
        phase: 'ready',
        sel: { text: text.slice(0, 2000), sectionIdx, x: r.left + r.width / 2, above: Math.max(60, r.top - 8) },
      })
    }

    function defer() { window.setTimeout(capture, 0) }
    document.addEventListener('selectionchange', capture)
    document.addEventListener('mouseup', defer)
    document.addEventListener('keyup', capture)
    window.addEventListener('resize', capture)
    window.addEventListener('scroll', capture, true)
    return () => {
      document.removeEventListener('selectionchange', capture)
      document.removeEventListener('mouseup', defer)
      document.removeEventListener('keyup', capture)
      window.removeEventListener('resize', capture)
      window.removeEventListener('scroll', capture, true)
    }
  }, []) // no deps — phaseRef keeps the closure fresh

  // ── API call ──────────────────────────────────────────────────────────────
  async function callTransform(sel: SelectionInfo, action: TransformAction) {
    set({ phase: 'loading', sel, action })
    try {
      const res = await fetch(`/api/topics/${encodeURIComponent(topicId)}/transform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, action, selectedText: sel.text, topicTitle }),
      })
      const data = await res.json() as { result?: string; error?: string }
      if (!res.ok || !data.result) throw new Error(data.error ?? 'Transform failed.')
      onTransformComplete(sel.sectionIdx, sel.text, data.result, action)
      set({ phase: 'idle' })
    } catch (err) {
      set({ phase: 'error', sel, action, message: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }

  function runTransform(action: TransformAction) {
    if (state.phase !== 'ready') return
    window.getSelection()?.removeAllRanges()
    callTransform(state.sel, action)
  }

  function attachToChat() {
    if (state.phase !== 'ready') return
    const selectedText = state.sel.text
    window.getSelection()?.removeAllRanges()
    onAttachToChat?.(selectedText)
    set({ phase: 'idle' })
  }

  function retry() {
    if (state.phase !== 'error') return
    callTransform(state.sel, state.action)
  }

  if (state.phase === 'idle') return null

  const { x, above } = 'sel' in state ? state.sel : { x: 0, above: 0 }

  return (
    <div
      className="selection-toolbar"
      style={{ left: x, top: above }}
      role="toolbar"
      aria-label="Text transform actions"
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.phase === 'ready' && (
        <>
          <button className="selection-toolbar-primary" type="button" onClick={attachToChat}>
            <IconMessageCircle size={13} stroke={2} aria-hidden />
            Ask
          </button>
          <span className="selection-toolbar-divider" aria-hidden />
          <button type="button" onClick={() => runTransform('simplify')}>
            <IconSparkles size={13} stroke={2} aria-hidden />
            Simplify
          </button>
          <span className="selection-toolbar-divider" aria-hidden />
          <button type="button" onClick={() => runTransform('deeper')}>
            <IconListDetails size={13} stroke={2} aria-hidden />
            Deeper
          </button>
          <span className="selection-toolbar-divider" aria-hidden />
          <button type="button" onClick={() => runTransform('example')}>
            <IconBulb size={13} stroke={2} aria-hidden />
            Example
          </button>
        </>
      )}

      {state.phase === 'loading' && (
        <span className="selection-toolbar-loading">
          <span className="selection-toolbar-spinner" aria-hidden />
          {LABELS[state.action]}…
        </span>
      )}

      {state.phase === 'error' && (
        <>
          <span className="selection-toolbar-error-msg">Failed</span>
          <span className="selection-toolbar-divider" aria-hidden />
          <button type="button" onClick={retry}>
            <IconRefresh size={13} stroke={2} aria-hidden />
            Retry
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => set({ phase: 'idle' })}>
            <IconX size={13} stroke={2} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}
