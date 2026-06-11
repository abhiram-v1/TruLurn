'use client'

import type { GraphData } from '@/lib/graph/types'

interface Filters {
  showLocked: boolean
  showCritical: boolean
  showRegions: boolean
  showRecommended: boolean
  showSemantic: boolean
  showAllConnections: boolean
  focusMode: boolean
}

interface Props {
  data: GraphData
  activeBranch: string
  setActiveBranch: (id: string) => void
  filters: Filters
  onToggle: (key: keyof Filters) => void
}

function FilterToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button className="kg-filter-row" onClick={onToggle} aria-pressed={on}>
      <span>{label}</span>
      <span className={`kg-toggle${on ? ' on' : ''}`} />
    </button>
  )
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="kg-legend-row">
      <span className="kg-swatch" style={{ background: `var(--${color})` }} />
      <span>{label}</span>
    </div>
  )
}

export function GraphSidebar({ data, activeBranch, setActiveBranch, filters, onToggle }: Props) {
  const { course, branches } = data
  const total = course.topicCount || 1
  const seg = (n: number) => `${(n / total) * 100}%`

  return (
    <aside className="kg-sidebar">
      <div className="kg-sb-scroll">
        <div className="kg-sb-section">
          <div className="kg-sb-label">Course</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{course.title}</div>
            <div style={{ fontSize: 11, color: 'var(--kg-muted)' }}>
              Color-coded by current learning signal
            </div>
            <div className="kg-progress-bar" style={{ marginTop: 6 }}>
              <span className="pb-mastered" style={{ width: seg(course.mastered) }} />
              <span className="pb-functional" style={{ width: seg(course.functional) }} />
              <span className="pb-partial" style={{ width: seg(course.partial) }} />
              <span className="pb-unstable" style={{ width: seg(course.unstable) }} />
            </div>
          </div>
        </div>

        <div className="kg-sb-section" style={{ padding: '10px 0' }}>
          <div className="kg-sb-label" style={{ padding: '0 16px' }}>Branches</div>
          <div style={{ display: 'grid' }}>
            <button
              className={`kg-branch-row${activeBranch === 'all' ? ' current' : ''}`}
              onClick={() => setActiveBranch('all')}
            >
              <span className="kg-branch-dot" style={{ background: 'var(--kg-accent)' }} />
              <span>All concepts</span>
              <span className="kg-branch-count">All</span>
            </button>
            {branches.map((b) => (
              <button
                key={b.id}
                className={`kg-branch-row${activeBranch === b.id ? ' current' : ''}${b.color === 'locked' ? ' dim' : ''}`}
                onClick={() => setActiveBranch(b.id)}
              >
                <span className={`kg-branch-dot ${b.color}`} />
                <span>{b.title}</span>
                <span className="kg-branch-count">{b.color === 'locked' ? 'Later' : 'Open'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="kg-sb-section">
          <div className="kg-sb-label">Filters</div>
          <div className="kg-filters">
            <FilterToggle label="Show locked topics" on={filters.showLocked} onToggle={() => onToggle('showLocked')} />
            <FilterToggle label="Show branch boxes" on={filters.showRegions} onToggle={() => onToggle('showRegions')} />
            <FilterToggle label="Highlight priority path" on={filters.showCritical} onToggle={() => onToggle('showCritical')} />
            <FilterToggle label="Recommended links" on={filters.showRecommended} onToggle={() => onToggle('showRecommended')} />
            <FilterToggle label="Semantic relationships" on={filters.showSemantic} onToggle={() => onToggle('showSemantic')} />
            <FilterToggle label="All connections" on={filters.showAllConnections} onToggle={() => onToggle('showAllConnections')} />
            <FilterToggle label="Focus mode" on={filters.focusMode} onToggle={() => onToggle('focusMode')} />
          </div>
        </div>

        <div className="kg-sb-section">
          <div className="kg-sb-label">Learning signals</div>
          <div className="kg-legend">
            <LegendRow color="kg-mastered-dot" label="Mastered" />
            <LegendRow color="kg-functional-dot" label="Functional" />
            <LegendRow color="kg-partial-dot" label="Developing" />
            <LegendRow color="kg-unstable-dot" label="Review" />
            <LegendRow color="kg-accent" label="Active" />
            <LegendRow color="kg-locked-line" label="Locked" />
          </div>
        </div>
      </div>
    </aside>
  )
}
