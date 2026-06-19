'use client'

// Source-based learning boundary panel. Shown at the top of the Atlas for
// source-based courses: makes the content boundary explicit — what the
// materials assume, and where they stop. These are surfaced as context
// only; no lessons exist for them by design.

import { useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'

const VISIBLE_LIMIT = 6

function ChipGroup({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, VISIBLE_LIMIT)
  const hiddenCount = items.length - visible.length

  return (
    <div className="source-scope-chips">
      {visible.map((item) => (
        <span className="source-scope-chip" key={item}>{item}</span>
      ))}
      {hiddenCount > 0 ? (
        <button type="button" className="source-scope-more" onClick={() => setExpanded(true)}>
          +{hiddenCount} more
        </button>
      ) : null}
      {expanded && items.length > VISIBLE_LIMIT ? (
        <button type="button" className="source-scope-more" onClick={() => setExpanded(false)}>
          Show less
        </button>
      ) : null}
    </div>
  )
}

export function SourceScopePanel({
  outOfScope,
}: {
  outOfScope: {
    assumed_prerequisites?: string[]
    mentioned_followups?: string[]
  } | null
}) {
  const [open, setOpen] = useState(false)
  const assumed = (outOfScope?.assumed_prerequisites ?? []).filter(Boolean)
  const followups = (outOfScope?.mentioned_followups ?? []).filter(Boolean)
  if (!assumed.length && !followups.length) return null

  return (
    <section className={`source-scope-panel atlas-float-card${open ? ' is-open' : ''}`}>
      <button type="button" className="atlas-float-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="source-scope-header">
          <strong>Built from your sources</strong>
          <span>Where your uploaded material&apos;s boundary sits.</span>
        </span>
        <IconChevronDown size={16} stroke={1.8} className="atlas-float-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="source-scope-lists">
          {assumed.length ? (
            <div className="source-scope-group">
              <span className="source-scope-label">Assumed background (not taught by your sources)</span>
              <ChipGroup items={assumed} />
            </div>
          ) : null}
          {followups.length ? (
            <div className="source-scope-group">
              <span className="source-scope-label">Mentioned next steps (beyond your sources)</span>
              <ChipGroup items={followups} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
