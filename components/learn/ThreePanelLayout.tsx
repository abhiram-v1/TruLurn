export function ThreePanelLayout({
  left,
  middle,
  right,
  roadmapCollapsed = false,
  doubtsExpanded = false,
}: {
  left: React.ReactNode
  middle: React.ReactNode
  right: React.ReactNode
  roadmapCollapsed?: boolean
  doubtsExpanded?: boolean
}) {
  return (
    <main
      className={[
        'learn-shell',
        roadmapCollapsed ? 'roadmap-collapsed' : '',
        doubtsExpanded ? 'doubts-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <aside className="roadmap-panel">{left}</aside>
      <section className="lesson-panel">{middle}</section>
      <aside className="chat-panel">{right}</aside>
    </main>
  )
}
