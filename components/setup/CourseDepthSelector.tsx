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

function getDepthIcon(value: CourseDepth) {
  if (value === 'low') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }
  if (value === 'standard') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    )
  }
  return (
    <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  )
}

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
            <div className="control-mode-option-header">
              {getDepthIcon(option.value)}
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
