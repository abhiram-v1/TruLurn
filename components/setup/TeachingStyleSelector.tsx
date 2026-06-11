'use client'

// User-selectable teaching styles. Ids must match LessonStyle in
// lib/ai/skills/lessonStyle.ts — the directive for each id lives there.
// 'auto' lets the pedagogy classifier pick from the full catalog at creation.
export type TeachingStyleChoice =
  | 'auto'
  | 'first_principles'
  | 'visual_analogy'
  | 'socratic'
  | 'project_based'
  | 'exam_oriented'
  | 'concise_speed'
  | 'deep_conceptual'

const STYLE_OPTIONS: Array<{ id: TeachingStyleChoice; name: string; description: string }> = [
  { id: 'auto', name: 'Auto', description: 'TruLurn picks the best style from your goal, then adapts as it learns how you study.' },
  { id: 'first_principles', name: 'First Principles', description: 'Everything rebuilt from the ground up — no rule arrives without its why.' },
  { id: 'visual_analogy', name: 'Visual & Analogy', description: 'Mental pictures first. Every abstract idea gets a concrete scene.' },
  { id: 'socratic', name: 'Socratic', description: 'Lessons teach by asking. You reason before the answer is revealed.' },
  { id: 'project_based', name: 'Project-Based', description: 'Learn each concept the moment a running build needs it.' },
  { id: 'exam_oriented', name: 'Exam-Oriented', description: 'Markable definitions, solved exam problems, traps and scoring patterns.' },
  { id: 'concise_speed', name: 'Concise & Fast', description: 'Maximum signal, minimum words — for fast movers.' },
  { id: 'deep_conceptual', name: 'Deep Conceptual', description: 'Slow and thorough — each idea from multiple angles until it is owned.' },
]

export function TeachingStyleSelector({
  value,
  onChange,
}: {
  value: TeachingStyleChoice
  onChange: (style: TeachingStyleChoice) => void
}) {
  return (
    <div className="field">
      <label>Teaching style</label>
      <div className="teaching-style-grid" role="radiogroup" aria-label="Teaching style">
        {STYLE_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`teaching-style-option ${value === option.id ? 'selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            onClick={() => onChange(option.id)}
          >
            <span className="teaching-style-name">{option.name}</span>
            <span className="teaching-style-desc">{option.description}</span>
          </button>
        ))}
      </div>
      <div className="field-note">
        How lessons explain things. You can change this anytime by asking the lesson assistant.
      </div>
    </div>
  )
}
