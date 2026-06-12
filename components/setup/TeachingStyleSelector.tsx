'use client'

import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'

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

const OPTIONS = [
  {
    value: 'auto' as TeachingStyleChoice,
    title: 'Auto',
    copy: 'TruLurn picks the best style from your goal, then adapts as it learns how you study.',
  },
  {
    value: 'first_principles' as TeachingStyleChoice,
    title: 'First Principles',
    copy: 'Everything rebuilt from the ground up — no rule arrives without its why.',
  },
  {
    value: 'visual_analogy' as TeachingStyleChoice,
    title: 'Visual & Analogy',
    copy: 'Mental pictures first. Every abstract idea gets a concrete scene.',
  },
  {
    value: 'socratic' as TeachingStyleChoice,
    title: 'Socratic',
    copy: 'Lessons teach by asking. You reason before the answer is revealed.',
  },
  {
    value: 'project_based' as TeachingStyleChoice,
    title: 'Project-Based',
    copy: 'Learn each concept the moment a running build needs it.',
  },
  {
    value: 'exam_oriented' as TeachingStyleChoice,
    title: 'Exam-Oriented',
    copy: 'Markable definitions, solved exam problems, traps and scoring patterns.',
  },
  {
    value: 'concise_speed' as TeachingStyleChoice,
    title: 'Concise & Fast',
    copy: 'Maximum signal, minimum words — for fast movers.',
  },
  {
    value: 'deep_conceptual' as TeachingStyleChoice,
    title: 'Deep Conceptual',
    copy: 'Slow and thorough — each idea from multiple angles until it is owned.',
  },
] as const

export function TeachingStyleSelector({
  value,
  onChange,
}: {
  value: TeachingStyleChoice
  onChange: (style: TeachingStyleChoice) => void
}) {
  return (
    <SetupField label="Teaching style" hint="Changeable anytime from the lesson assistant">
      <OptionCardGroup
        label="Teaching style"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        columns={4}
        compact
      />
    </SetupField>
  )
}
