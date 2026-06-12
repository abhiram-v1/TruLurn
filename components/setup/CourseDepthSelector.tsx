import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'
import type { CourseDepth } from '@/types'

const OPTIONS = [
  {
    value: 'low' as CourseDepth,
    title: 'Overview',
    copy: 'Core concepts and key intuitions only. Faster to complete.',
    meta: 'Best for surveys or partial refreshers.',
  },
  {
    value: 'standard' as CourseDepth,
    title: 'Standard',
    copy: 'Balanced coverage with clear explanations and examples.',
    meta: 'Recommended for most courses.',
  },
  {
    value: 'high' as CourseDepth,
    title: 'Mastery',
    copy: 'Comprehensive treatment with deeper reasoning and edge cases.',
    meta: 'Best for professional-level learning.',
  },
] as const

export function CourseDepthSelector({
  value,
  onChange,
}: {
  value: CourseDepth
  onChange: (depth: CourseDepth) => void
}) {
  return (
    <SetupField label="Depth" hint="How much detail each topic gets">
      <OptionCardGroup
        label="Course depth"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </SetupField>
  )
}
