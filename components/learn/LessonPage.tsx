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
          Supervised learning / {topicTitle}
        </div>
        <h1 className="lesson-title">How the idea works</h1>
        <div className="lesson-body">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
    </div>
  )
}
