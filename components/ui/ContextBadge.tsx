export function ContextBadge({
  topicTitle,
  pageNumber,
  globalPageNumber,
}: {
  topicTitle: string
  pageNumber: number
  globalPageNumber?: number
}) {
  return (
    <span className="context-badge">
      {topicTitle} - p{pageNumber}{globalPageNumber ? ` - course p${globalPageNumber}` : ''}
    </span>
  )
}
