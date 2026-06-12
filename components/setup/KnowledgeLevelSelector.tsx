import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'
import type { KnowledgeLevel } from '@/types'

const OPTIONS = [
  {
    value: 'beginner' as KnowledgeLevel,
    title: 'Beginner',
    copy: 'Intuition and real-world hooks first. Definitions arrive after the mental model exists.',
    meta: 'Completely new to this subject.',
  },
  {
    value: 'intermediate' as KnowledgeLevel,
    title: 'Intermediate',
    copy: 'Skips basics. Focuses on the why, connections, alternatives, and where things break.',
    meta: 'Know the fundamentals, want real depth.',
  },
  {
    value: 'expert' as KnowledgeLevel,
    title: 'Expert',
    copy: 'Formal models first: derivations, failure modes, tradeoffs, and research context.',
    meta: 'Want theory, proofs, and hidden insights.',
  },
] as const

export function KnowledgeLevelSelector({
  value,
  onChange,
}: {
  value: KnowledgeLevel
  onChange: (level: KnowledgeLevel) => void
}) {
  return (
    <SetupField label="Knowledge level" hint="Same topic, completely different page">
      <OptionCardGroup
        label="Knowledge level"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </SetupField>
  )
}
