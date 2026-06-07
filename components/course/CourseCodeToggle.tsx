'use client'

import { useState, useTransition } from 'react'

// Supported code languages. Extend as needed.
const CODE_LANGUAGES = [
  { id: 'python',     label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'r',          label: 'R' },
]

interface CourseCodeToggleProps {
  courseId: string
  initialLanguage: string | null
}

export function CourseCodeToggle({ courseId, initialLanguage }: CourseCodeToggleProps) {
  const [lang, setLang] = useState<string | null>(initialLanguage)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function apply(next: string | null) {
    setLang(next)
    setOpen(false)
    startTransition(async () => {
      await fetch(`/api/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code_language: next }),
      })
    })
  }

  const active = CODE_LANGUAGES.find((l) => l.id === lang)

  return (
    <div className="code-toggle-wrap" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={`button-subtle code-toggle-btn${lang ? ' active' : ''}`}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={lang ? `Code examples: ${active?.label ?? lang}` : 'Add code examples to lessons'}
        disabled={isPending}
        style={{ gap: 6, display: 'flex', alignItems: 'center' }}
      >
        <span style={{ fontSize: 15 }}>{'<>'}</span>
        {lang ? `${active?.label ?? lang} examples` : 'Code examples'}
      </button>

      {open && (
        <div
          className="code-toggle-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--surface-1, #1c1c1e)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            borderRadius: 10,
            padding: '6px 0',
            minWidth: 180,
            zIndex: 200,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ padding: '6px 14px 4px', fontSize: 11, color: 'var(--text-3, #888)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Code examples in lessons
          </div>
          {CODE_LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => apply(lang === l.id ? null : l.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: lang === l.id ? 'var(--accent, #6c8eff)' : 'var(--text-1, #e0e0e0)',
                textAlign: 'left',
              }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: lang === l.id ? 'var(--accent, #6c8eff)' : 'transparent',
                border: '1.5px solid',
                borderColor: lang === l.id ? 'var(--accent, #6c8eff)' : 'var(--border, rgba(255,255,255,0.2))',
                flexShrink: 0,
              }} />
              {l.label}
              {lang === l.id && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3, #888)' }}>tap to remove</span>
              )}
            </button>
          ))}
          {lang && (
            <>
              <div style={{ margin: '4px 14px', borderTop: '1px solid var(--border, rgba(255,255,255,0.08))' }} />
              <button
                type="button"
                onClick={() => apply(null)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--text-3, #888)',
                  textAlign: 'left',
                }}
              >
                Turn off code examples
              </button>
            </>
          )}
          <div style={{ padding: '4px 14px 6px', fontSize: 11, color: 'var(--text-3, #888)', lineHeight: 1.5 }}>
            New pages will include code snippets when they help explain a concept.
            Already-generated pages are unaffected.
          </div>
        </div>
      )}

      {/* Close on outside click */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 199 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  )
}
