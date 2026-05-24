export function ThreePanelLayout({
  left,
  middle,
  right,
}: {
  left: React.ReactNode
  middle: React.ReactNode
  right: React.ReactNode
}) {
  return (
    <main className="learn-shell">
      <aside className="roadmap-panel">{left}</aside>
      <section className="lesson-panel">{middle}</section>
      <aside className="chat-panel">{right}</aside>
    </main>
  )
}
