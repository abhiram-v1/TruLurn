import type { CourseDepth } from '@/types'

const OPTIONS: Array<{
  value: CourseDepth
  title: string
  copy: string
  meta: string
}> = [
  {
    value: 'low',
    title: 'Overview',
    copy: 'Core concepts and key intuitions only. Faster to complete, optimized for quick understanding.',
    meta: 'Best for broad surveys or topics you already know partially.',
  },
  {
    value: 'standard',
    title: 'Standard',
    copy: 'Balanced coverage with clear explanations, examples, and practical context.',
    meta: 'Recommended for most courses.',
  },
  {
    value: 'high',
    title: 'Mastery',
    copy: 'Comprehensive treatment including deeper reasoning, edge cases, and additional examples.',
    meta: 'Best for professional-level learning or high-stakes subjects.',
  },
]

export function CourseDepthSelector({
  value,
  onChange,
}: {
  value: CourseDepth
  onChange: (depth: CourseDepth) => void
}) {
  return (
    <section className="field">
      <div className="field-label-row">
        <label>Depth</label>
        <span>Course detail level</span>
      </div>
      <div className="control-mode-grid" role="radiogroup" aria-label="Course depth">
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
