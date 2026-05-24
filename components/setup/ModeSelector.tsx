import type { CourseMode } from '@/types'

export function ModeSelector({
  value,
  onChange,
}: {
  value: CourseMode
  onChange: (mode: CourseMode) => void
}) {
  return (
    <div className="mode-grid">
      <button
        className={`mode-option ${value === 'ai_teacher' ? 'selected' : ''}`}
        type="button"
        onClick={() => onChange('ai_teacher')}
      >
        <div className="mode-title">AI as Teacher</div>
        <div className="mode-copy">Start from a topic and goal. TruLurn builds a curriculum from model knowledge.</div>
      </button>
      <button className="mode-option disabled" type="button" disabled>
        <div className="mode-title">Source Grounded</div>
        <div className="mode-copy">Upload PDFs, slides, links, or notes. Coming after the core loop works.</div>
      </button>
    </div>
  )
}
