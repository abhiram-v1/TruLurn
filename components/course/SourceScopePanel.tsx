// Source-based learning boundary panel (server component).
// Shown on the Atlas for source-based courses: makes the content boundary
// explicit — what the materials assume, and where they stop. These are
// surfaced as context only; no lessons exist for them by design.

export function SourceScopePanel({
  outOfScope,
}: {
  outOfScope: {
    assumed_prerequisites?: string[]
    mentioned_followups?: string[]
  } | null
}) {
  const assumed = (outOfScope?.assumed_prerequisites ?? []).filter(Boolean)
  const followups = (outOfScope?.mentioned_followups ?? []).filter(Boolean)
  if (!assumed.length && !followups.length) return null

  return (
    <section className="source-scope-panel">
      <div className="source-scope-header">
        <strong>Built from your sources</strong>
        <span>Every lesson in this course comes from your uploaded material. Here is where that material&apos;s boundary sits.</span>
      </div>
      <div className="source-scope-lists">
        {assumed.length ? (
          <div className="source-scope-group">
            <span className="source-scope-label">Assumed background (not taught by your sources)</span>
            <div className="source-scope-chips">
              {assumed.map((item) => (
                <span className="source-scope-chip" key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
        {followups.length ? (
          <div className="source-scope-group">
            <span className="source-scope-label">Mentioned next steps (beyond your sources)</span>
            <div className="source-scope-chips">
              {followups.map((item) => (
                <span className="source-scope-chip" key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
