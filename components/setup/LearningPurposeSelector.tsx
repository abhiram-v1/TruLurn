import type { LearningPurpose } from '@/types'

const OPTIONS: Array<{
  value: LearningPurpose
  title: string
  copy: string
  meta: string
}> = [
  {
    value: 'explorer',
    title: 'Explorer',
    copy: 'You want to understand how things work in principle. Intuition, mental models, and the "why" come first.',
    meta: 'Learning out of curiosity or for a broad grasp.',
  },
  {
    value: 'practitioner',
    title: 'Practitioner',
    copy: 'You want to build real things. Lessons focus on applied skill, tools, patterns, and what actually works.',
    meta: 'Recommended if you want to use this, not just know it.',
  },
  {
    value: 'researcher',
    title: 'Researcher',
    copy: 'You want deep theory. Derivations, assumptions, edge cases, and the open questions at the frontier.',
    meta: 'Best for rigorous, theory-first study.',
  },
]

function getPurposeIcon(value: LearningPurpose) {
  if (value === 'explorer') {
    // Compass
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
      </svg>
    )
  }
  if (value === 'practitioner') {
    // Wrench / build
    return (
      <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17 20.75a2 2 0 002.83-2.83l-5.59-5.58m-2.82 2.83a4.5 4.5 0 01-6-6l2.6 2.6 2.12-2.12-2.6-2.6a4.5 4.5 0 016 6z" />
      </svg>
    )
  }
  // researcher — microscope-ish / atom
  return (
    <svg className="control-mode-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-2.5 4-2.5 14 0 18M12 3c2.5 4 2.5 14 0 18M3.5 7.5c4 2 13 2 17 0M3.5 16.5c4-2 13-2 17 0" />
    </svg>
  )
}

export function LearningPurposeSelector({
  value,
  onChange,
}: {
  value: LearningPurpose
  onChange: (purpose: LearningPurpose) => void
}) {
  return (
    <section className="field">
      <div className="field-label-row">
        <label>Purpose</label>
        <span>Why you&rsquo;re learning this — shapes what each lesson emphasizes</span>
      </div>
      <div className="control-mode-grid" role="radiogroup" aria-label="Learning purpose">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`control-mode-option ${value === option.value ? 'selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {getPurposeIcon(option.value)}
            <span className="control-mode-title">{option.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
