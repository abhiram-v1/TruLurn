import type { LearningControlMode } from '@/types'

const OPTIONS: Array<{
  value: LearningControlMode
  title: string
  copy: string
  meta: string
}> = [
  {
    value: 'guided',
    title: 'Guided path',
    copy: 'Progress opens through completed lessons and quiz evidence.',
    meta: 'Best for new or high-stakes subjects.',
  },
  {
    value: 'balanced',
    title: 'Balanced path',
    copy: 'Keeps structure, but lets the agent skip or trim basics when you show understanding.',
    meta: 'Recommended for most courses.',
  },
  {
    value: 'open',
    title: 'Open path',
    copy: 'Lets you jump ahead while Atlas and Graph remember what was skipped.',
    meta: 'Best when you already know the fundamentals.',
  },
]

function getProgressionIcon(value: LearningControlMode) {
  if (value === 'guided') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (value === 'balanced') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    )
  }
  return (
    <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

export function LearningControlSelector({
  value,
  onChange,
}: {
  value: LearningControlMode
  onChange: (mode: LearningControlMode) => void
}) {
  return (
    <section className="field">
      <div className="field-label-row">
        <label>Progression</label>
        <span>Course policy</span>
      </div>
      <div className="control-mode-grid" role="radiogroup" aria-label="Course progression mode">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`control-mode-option ${value === option.value ? 'selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
          >
            <div className="control-mode-option-header">
              {getProgressionIcon(option.value)}
              <span className="control-mode-title">{option.title}</span>
            </div>
            <span className="control-mode-copy">{option.copy}</span>
            <span className="control-mode-meta">{option.meta}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
