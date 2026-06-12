import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'
import type { LearningPurpose } from '@/types'

const OPTIONS = [
  {
    value: 'explorer' as LearningPurpose,
    title: 'Explorer',
    copy: 'Understand how things work in principle. Mental models and the why come first.',
    meta: 'Learning out of curiosity or for a broad grasp.',
  },
  {
    value: 'practitioner' as LearningPurpose,
    title: 'Practitioner',
    copy: 'Build real things. Applied skill, tools, patterns, and what actually works.',
    meta: 'Recommended if you want to use this, not just know it.',
  },
  {
    value: 'researcher' as LearningPurpose,
    title: 'Researcher',
    copy: 'Deep theory: derivations, assumptions, edge cases, and open questions.',
    meta: 'Best for rigorous, theory-first study.',
  },
] as const

export function LearningPurposeSelector({
  value,
  onChange,
}: {
  value: LearningPurpose
  onChange: (purpose: LearningPurpose) => void
}) {
  return (
    <SetupField label="Purpose" hint="Shapes what each lesson emphasizes">
      <OptionCardGroup
        label="Learning purpose"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </SetupField>
  )
}
