import type { CourseMode } from '@/types'

export function ModeSelector({
  value,
  onChange,
}: {
  value: CourseMode
  onChange: (mode: CourseMode) => void
}) {
  return (
    <div className="mode-grid" role="radiogroup" aria-label="Course source">
      <button
        className={`mode-option ${value === 'ai_teacher' ? 'selected' : ''}`}
        type="button"
        role="radio"
        aria-checked={value === 'ai_teacher'}
        onClick={() => onChange('ai_teacher')}
      >
        <div className="mode-option-header">
          <svg className="mode-icon" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l-.813-5.096L3.096 15 8 14.187 8.813 9l.813 5.187 4.904.813-4.904.904z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.071 4.929l-.707 3.535-3.536.708 3.536.707.707 3.536.707-3.536 3.535-.707-3.535-.708-.707-3.535z" />
          </svg>
          <div className="mode-title">AI as Teacher</div>
        </div>
        <div className="mode-copy">Start from a topic and goal. TruLurn builds a curriculum from model knowledge.</div>
      </button>
      <button
        className={`mode-option ${value === 'source_grounded' ? 'selected' : ''}`}
        type="button"
        role="radio"
        aria-checked={value === 'source_grounded'}
        onClick={() => onChange('source_grounded')}
      >
        <div className="mode-option-header">
          <svg className="mode-icon" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <div className="mode-title">Source-Based Learning</div>
        </div>
        <div className="mode-copy">Upload documents or notes. TruLurn builds lessons only from your material — every lesson stays traceable to your sources.</div>
      </button>
    </div>
  )
}
