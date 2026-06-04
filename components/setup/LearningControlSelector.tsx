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
            <span className="control-mode-title">{option.title}</span>
            <span className="control-mode-copy">{option.copy}</span>
            <span className="control-mode-meta">{option.meta}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
