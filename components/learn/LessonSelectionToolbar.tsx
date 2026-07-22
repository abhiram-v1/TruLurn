'use client'

import { IconBulb, IconListDetails, IconMessageCircle, IconRefresh, IconSparkles, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { normalizeSelectionText, type MarkdownSelectionAnchor } from '@/lib/markdown-selection'
import type { TransformAction } from '@/lib/topic-transform'

export type { TransformAction } from '@/lib/topic-transform'

type SelectionInfo = MarkdownSelectionAnchor & {
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
  prepareTransform,
  onTransformComplete,
  onAttachToChat,
}: {
  topicId: string
  courseId: string
  topicTitle: string
  /** Resolves/expands rendered text to a safe Markdown-backed edit target before calling AI. */
  prepareTransform?: (sectionIdx: number, selection: MarkdownSelectionAnchor, action: TransformAction) => MarkdownSelectionAnchor | null
  /** Called when the AI returns a result. The caller applies it inline. */
  onTransformComplete: (sectionIdx: number, selection: MarkdownSelectionAnchor, result: string, action: TransformAction) => boolean
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
      const text = normalizeSelectionText(selection.toString())
      if (text.length < 5 || text.length > 6000) { set({ phase: 'idle' }); return }

      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (!el?.closest('.lesson-body, .lesson-sections')) { set({ phase: 'idle' }); return }

      // Which section is this text in? (structured pages only)
      const sectionEl = el.closest('[data-section-index]')
      const sectionIdx = sectionEl ? parseInt(sectionEl.getAttribute('data-section-index') ?? '-1') : -1
      if (el.closest('.lesson-sections') && !sectionEl) { set({ phase: 'idle' }); return }

      let before = ''
      let after = ''
      if (sectionEl && sectionEl.contains(range.startContainer) && sectionEl.contains(range.endContainer)) {
        const beforeRange = range.cloneRange()
        beforeRange.selectNodeContents(sectionEl)
        beforeRange.setEnd(range.startContainer, range.startOffset)
        before = normalizeSelectionText(beforeRange.toString()).slice(-240)

        const afterRange = range.cloneRange()
        afterRange.selectNodeContents(sectionEl)
        afterRange.setStart(range.endContainer, range.endOffset)
        after = normalizeSelectionText(afterRange.toString()).slice(0, 240)
      }

      const rect = range.getBoundingClientRect()
      const fr = range.getClientRects()[0]
      const r = (rect.width || rect.height) ? rect : fr
      if (!r) return

      set({
        phase: 'ready',
        sel: { text, before, after, sectionIdx, x: r.left + r.width / 2, above: Math.max(60, r.top - 8) },
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
        body: JSON.stringify({
          courseId,
          action,
          selectedText: sel.text,
          contextBefore: sel.before,
          contextAfter: sel.after,
          topicTitle,
        }),
      })
      const data = await res.json() as { result?: string; error?: string }
      if (!res.ok || !data.result) throw new Error(data.error ?? 'Transform failed.')
      const applied = onTransformComplete(sel.sectionIdx, sel, data.result, action)
      if (!applied) {
        throw new Error('That selection could not be matched safely. Select the passage again and retry.')
      }
      set({ phase: 'idle' })
    } catch (err) {
      set({ phase: 'error', sel, action, message: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }

  function runTransform(action: TransformAction) {
    if (state.phase !== 'ready') return
    const prepared = prepareTransform
      ? prepareTransform(state.sel.sectionIdx, state.sel, action)
      : state.sel
    if (!prepared) {
      set({
        phase: 'error',
        sel: state.sel,
        action,
        message: 'That selection could not be matched safely. Select the passage again and retry.',
      })
      return
    }
    window.getSelection()?.removeAllRanges()
    callTransform({ ...state.sel, ...prepared }, action)
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
    const prepared = prepareTransform
      ? prepareTransform(state.sel.sectionIdx, state.sel, state.action)
      : state.sel
    if (!prepared) return
    callTransform({ ...state.sel, ...prepared }, state.action)
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
          <span className="selection-toolbar-error-msg" title={state.message} aria-label={state.message}>Failed</span>
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
