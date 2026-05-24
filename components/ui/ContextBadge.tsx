export function ContextBadge({
  topicTitle,
  pageNumber,
}: {
  topicTitle: string
  pageNumber: number
}) {
  return (
    <span className="context-badge">
      {topicTitle} · p{pageNumber}
    </span>
  )
}
