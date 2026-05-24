import type { TopicState } from '@/types'

export function TopicPill({ state }: { state: TopicState }) {
  return <span className={`state-pill ${state}`}>{state}</span>
}
