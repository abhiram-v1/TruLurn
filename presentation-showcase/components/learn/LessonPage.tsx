import type { Page } from '@/types'

export function LessonPage({
  page,
  topicTitle,
  totalPages,
}: {
  page: Page
  topicTitle: string
  totalPages: number
}) {
  const paragraphs = page.content.split('\n\n')

  return (
    <div className="lesson-content">
      <article className="lesson-inner">
        <div className="lesson-kicker">
          {topicTitle} / Page {page.page_number} of {totalPages}
        </div>
        <h1 className="lesson-title">{topicTitle}</h1>
        <div className="lesson-body">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
    </div>
  )
}
