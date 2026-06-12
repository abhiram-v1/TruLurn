import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'
import type { LearningControlMode } from '@/types'

const OPTIONS = [
  {
    value: 'guided' as LearningControlMode,
    title: 'Guided',
    copy: 'Progress opens through completed lessons and quiz evidence.',
    meta: 'Best for new or high-stakes subjects.',
  },
  {
    value: 'balanced' as LearningControlMode,
    title: 'Balanced',
    copy: 'Keeps structure, but trims basics once you show understanding.',
    meta: 'Recommended for most courses.',
  },
  {
    value: 'open' as LearningControlMode,
    title: 'Open',
    copy: 'Jump ahead freely while the Atlas remembers what was skipped.',
    meta: 'Best when you know the fundamentals.',
  },
] as const

export function LearningControlSelector({
  value,
  onChange,
}: {
  value: LearningControlMode
  onChange: (mode: LearningControlMode) => void
}) {
  return (
    <SetupField label="Progression" hint="How strictly topics unlock">
      <OptionCardGroup
        label="Course progression mode"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </SetupField>
  )
}
