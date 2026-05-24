export function ContextBadge({ topicTitle, pageNumber }: { topicTitle: string; pageNumber: number }) {
  return (
    <div className="context-badge">
      Context: {topicTitle} - Page {pageNumber}
    </div>
  )
}
