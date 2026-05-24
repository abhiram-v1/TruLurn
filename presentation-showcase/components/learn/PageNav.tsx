import Link from 'next/link'
import { PagePaginator } from '@/components/ui/PagePaginator'

export function PageNav({
  currentPage,
  totalPages,
  courseId,
  topicId,
}: {
  currentPage: number
  totalPages: number
  courseId: string
  topicId: string
}) {
  const previous = Math.max(1, currentPage - 1)
  const next = Math.min(totalPages, currentPage + 1)

  return (
    <nav className="page-nav">
      {currentPage === 1 ? (
        <button className="button-quiet" type="button" disabled>
          Previous
        </button>
      ) : (
        <Link className="button-quiet" href={`/learn/${courseId}/${topicId}?page=${previous}`}>
          Previous
        </Link>
      )}
      <PagePaginator current={currentPage} total={totalPages} />
      {currentPage === totalPages ? (
        <Link className="button" href={`/quiz/${topicId}`}>
          Take quiz
        </Link>
      ) : (
        <Link className="button-subtle" href={`/learn/${courseId}/${topicId}?page=${next}`}>
          Next
        </Link>
      )}
    </nav>
  )
}
