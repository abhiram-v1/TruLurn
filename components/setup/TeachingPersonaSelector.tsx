'use client'

import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'
import type { TeachingPersonaId } from '@/lib/personas'

const OPTIONS = [
  {
    value: 'immersive_builder' as TeachingPersonaId,
    title: 'Immersive Builder',
    copy: 'Starts from meaning, builds toward precision, and closes with something you can use.',
    meta: 'Adaptive explanation and application',
  },
  {
    value: 'investigator' as TeachingPersonaId,
    title: 'Investigator',
    copy: 'Inspects anomalies, evidence, tempting explanations, and the mechanism that resolves them.',
    meta: 'Evidence, diagnosis, and hidden mechanisms',
  },
] as const

export function TeachingPersonaSelector({
  value,
  onChange,
}: {
  value: TeachingPersonaId
  onChange: (persona: TeachingPersonaId) => void
}) {
  return (
    <SetupField label="Teaching persona" hint="Controls lesson delivery, agent behavior, quizzes, and recall">
      <OptionCardGroup
        label="Teaching persona"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        columns={2}
      />
    </SetupField>
  )
}
