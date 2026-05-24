export function PagePaginator({ current, total }: { current: number; total: number }) {
  return (
    <span className="paginator">
      Page {current} of {total}
    </span>
  )
}
