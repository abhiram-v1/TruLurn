import { OptionCardGroup } from '@/components/setup/OptionCardGroup'
import type { CourseMode } from '@/types'

const OPTIONS = [
  {
    value: 'ai_teacher' as CourseMode,
    title: 'AI as Teacher',
    copy: 'Start from a topic and goal. TruLurn researches the subject and builds a complete curriculum from model knowledge.',
    meta: 'Best for learning something new end to end.',
  },
  {
    value: 'source_grounded' as CourseMode,
    title: 'Source-Based Learning',
    copy: 'Upload documents or notes. Lessons are built only from your material — every page stays traceable to your sources.',
    meta: 'Best for course notes, textbooks, or exam prep.',
  },
] as const

export function ModeSelector({
  value,
  onChange,
}: {
  value: CourseMode
  onChange: (mode: CourseMode) => void
}) {
  return (
    <OptionCardGroup
      label="Course source"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      columns={2}
    />
  )
}
