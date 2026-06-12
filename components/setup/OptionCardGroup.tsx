'use client'

// Shared radio-card group for the course setup form.
// One implementation, one visual language: a dot indicator carries the
// selection state — no decorative icons. Every option explains itself with
// a title, a one-line description, and an optional fine-print meta line.

export type OptionCard<T extends string> = {
  value: T
  title: string
  copy?: string
  meta?: string
}

export function OptionCardGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 3,
  compact = false,
}: {
  label: string
  options: ReadonlyArray<OptionCard<T>>
  value: T
  onChange: (value: T) => void
  /** Grid columns on desktop (collapses responsively). */
  columns?: 2 | 3 | 4
  /** Tighter padding/typography for large option sets. */
  compact?: boolean
}) {
  return (
    <div
      className={`setup-option-grid cols-${columns}${compact ? ' compact' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            className={`setup-option${selected ? ' selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
          >
            <span className="setup-option-head">
              <span className="setup-option-dot" aria-hidden="true" />
              <span className="setup-option-title">{option.title}</span>
            </span>
            {option.copy ? <span className="setup-option-copy">{option.copy}</span> : null}
            {option.meta ? <span className="setup-option-meta">{option.meta}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Label + optional hint + control. Standard chrome for every setup field. */
export function SetupField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="setup-field">
      <div className="setup-field-head">
        <span className="setup-field-label">{label}</span>
        {hint ? <span className="setup-field-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}
