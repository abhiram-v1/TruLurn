import type { KnowledgeLevel } from '@/types'

const OPTIONS: Array<{
  value: KnowledgeLevel
  title: string
  copy: string
  meta: string
}> = [
  {
    value: 'beginner',
    title: 'Beginner',
    copy: 'Starts with intuition and real-world hooks. Definitions come after the mental model exists, not before.',
    meta: 'Completely new to this subject.',
  },
  {
    value: 'intermediate',
    title: 'Intermediate',
    copy: 'Skips basics. Focuses on the "why", connections between concepts, alternatives, and where things break.',
    meta: 'Know the fundamentals, want real depth.',
  },
  {
    value: 'expert',
    title: 'Expert',
    copy: 'Formal models first. Derivations, failure modes, tradeoffs, and research context. No hand-holding.',
    meta: 'Want theory, proofs, and hidden insights.',
  },
]

function getLevelIcon(value: KnowledgeLevel) {
  if (value === 'beginner') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
      </svg>
    )
  }
  if (value === 'intermediate') {
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    )
  }
  // expert
  return (
    <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  )
}

export function KnowledgeLevelSelector({
  value,
  onChange,
}: {
  value: KnowledgeLevel
  onChange: (level: KnowledgeLevel) => void
}) {
  return (
    <section className="field">
      <div className="field-label-row">
        <label>Knowledge level</label>
        <span>How lessons are structured — same topic, completely different page</span>
      </div>
      <div className="control-mode-grid" role="radiogroup" aria-label="Knowledge level">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`control-mode-option ${value === option.value ? 'selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {getLevelIcon(option.value)}
            <span className="control-mode-title">{option.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
