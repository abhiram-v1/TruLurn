'use client'

import { OptionCardGroup, SetupField } from '@/components/setup/OptionCardGroup'

export type RecallBreakMode = 'auto' | '30m' | '60m' | 'off'

const OPTIONS = [
  {
    value: 'auto' as RecallBreakMode,
    title: 'Adaptive',
    copy: 'Suggests recall when study time and concept load say it helps most.',
  },
  {
    value: '30m' as RecallBreakMode,
    title: 'Every 30 min',
    copy: 'A steady recall pause after each half hour of active study.',
  },
  {
    value: '60m' as RecallBreakMode,
    title: 'Every 60 min',
    copy: 'Longer uninterrupted blocks with an hourly recall pause.',
  },
  {
    value: 'off' as RecallBreakMode,
    title: 'Manual only',
    copy: 'No scheduled prompts. Recall stays in the lesson toolbar.',
  },
] as const

const PRESET_MINUTES = [5, 10, 15, 20]

export function RecallBreakSelector({
  value,
  onChange,
  durationMinutes,
  onDurationChange,
}: {
  value: RecallBreakMode
  onChange: (mode: RecallBreakMode) => void
  durationMinutes: number
  onDurationChange: (minutes: number) => void
}) {
  return (
    <SetupField label="Recall breaks" hint="Changeable anytime in Settings">
      <OptionCardGroup
        label="Recall break timing"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        columns={4}
        compact
      />
      <div className="break-duration-control">
        <div className="break-duration-heading">
          <span>Break length</span>
          <strong>{durationMinutes} min</strong>
        </div>
        <input
          className="break-duration-slider"
          type="range"
          min={5}
          max={45}
          step={1}
          value={durationMinutes}
          onChange={(event) => onDurationChange(Number(event.target.value))}
          aria-label="Break duration in minutes"
        />
        <div className="break-duration-presets" aria-label="Break duration presets">
          {PRESET_MINUTES.map((minutes) => (
            <button
              key={minutes}
              className={durationMinutes === minutes ? 'selected' : ''}
              type="button"
              onClick={() => onDurationChange(minutes)}
            >
              {minutes} min
            </button>
          ))}
          <span>{PRESET_MINUTES.includes(durationMinutes) ? 'Drag for custom' : 'Custom'}</span>
        </div>
      </div>
    </SetupField>
  )
}
