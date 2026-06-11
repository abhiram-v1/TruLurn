'use client'

import { useEffect, useRef, useState } from 'react'

type Signal = 'got_it' | 'lost_me' | 'too_basic'

// localStorage key — if set to '1', the bar never renders again.
const NEVER_KEY = 'lf_never_ask'

const OPTIONS: Array<{ signal: Signal; label: string; icon: string }> = [
  { signal: 'got_it',   label: 'Got it',   icon: '✓' },
  { signal: 'lost_me',  label: 'Lost me',  icon: '?' },
  { signal: 'too_basic', label: 'Too basic', icon: '↑' },
]

// Compact acknowledgment shown after the student picks a signal.
const ACK: Record<Signal, string> = {
  got_it:   'Got it — keeping this level.',
  lost_me:  'Next pages will be gentler.',
  too_basic: 'Next pages will go deeper.',
}

export function LessonFeedback({
  courseId,
  topicId,
  pageNumber,
  onReexplain,
  isRegenerating,
}: {
  courseId: string
  topicId: string
  pageNumber: number
  onReexplain?: (approach: string) => void
  isRegenerating?: boolean
}) {
  const [selected, setSelected]   = useState<Signal | null>(null)
  const [sending, setSending]     = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [menuOpen, setMenuOpen]   = useState(false)

  // Read localStorage on the client only — avoid SSR mismatch.
  const [neverAsk, setNeverAsk] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNeverAsk(localStorage.getItem(NEVER_KEY) === '1')
    }
  }, [])

  const menuRef = useRef<HTMLDivElement>(null)

  // Reset per page — each page collects its own signal independently.
  useEffect(() => {
    setSelected(null)
    setDismissed(false)
    setMenuOpen(false)
  }, [topicId, pageNumber])

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!menuOpen) return
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [menuOpen])

  // Never ask again — write to localStorage and hide immediately.
  function disableForever() {
    if (typeof window !== 'undefined') localStorage.setItem(NEVER_KEY, '1')
    setNeverAsk(true)
    setMenuOpen(false)
  }

  // Fully hidden — either "never ask" or dismissed for this page.
  if (neverAsk || dismissed) return null

  async function send(signal: Signal) {
    if (sending || selected) return
    setSelected(signal)
    setSending(true)
    try {
      await fetch('/api/lessons/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, topicId, pageNumber, signal }),
      })
    } catch {
      // Non-critical.
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="lf-bar">
      <div className="lf-content">
        {selected ? (
          /* ── After selection: compact acknowledgment ── */
          <div className="lf-ack">
            <span className="lf-ack-dot" aria-hidden="true">✓</span>
            <span className="lf-ack-text">{ACK[selected]}</span>
            {selected === 'lost_me' && onReexplain ? (
              <button
                className="lf-reexplain"
                type="button"
                onClick={() => onReexplain('simplify')}
                disabled={isRegenerating}
              >
                {isRegenerating ? 'Re-explaining…' : 'Re-explain simpler →'}
              </button>
            ) : null}
          </div>
        ) : (
          /* ── Before selection: prompt + three buttons ── */
          <>
            <span className="lf-prompt">How was this page?</span>
            <div className="lf-buttons" role="group" aria-label="Page feedback">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.signal}
                  type="button"
                  className="lf-btn"
                  onClick={() => send(opt.signal)}
                  disabled={sending}
                >
                  <span className="lf-icon" aria-hidden="true">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Dismiss control ── */}
      <div className="lf-dismiss" ref={menuRef}>
        <button
          className="lf-x"
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Dismiss feedback bar"
          aria-expanded={menuOpen}
        >
          ✕
        </button>
        {menuOpen && (
          <div className="lf-menu" role="menu">
            <button
              className="lf-menu-item"
              type="button"
              role="menuitem"
              onClick={() => { setDismissed(true); setMenuOpen(false) }}
            >
              Remove from this page
            </button>
            <button
              className="lf-menu-item lf-menu-item--danger"
              type="button"
              role="menuitem"
              onClick={disableForever}
            >
              Never ask again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
