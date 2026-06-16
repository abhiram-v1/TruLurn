import type { Page } from '@/types'
import { LessonSections, type SectionOverride } from '@/components/learn/LessonSections'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

export type LessonPdfEntry = {
  page: Page
  topicTitle: string
  topicPageTotal: number
  globalPageNumber: number
}

export function LessonPdfDocument({
  entries,
  currentPageId,
  currentPageOverrides,
  globalPageTotal,
}: {
  entries: LessonPdfEntry[]
  currentPageId: string
  currentPageOverrides?: Map<number, SectionOverride>
  globalPageTotal: number
}) {
  return (
    <div className="lesson-pdf-document" aria-hidden="true">
      {entries.map(({ page, topicTitle, topicPageTotal, globalPageNumber }) => {
        const isStructured = Boolean(page.sections?.length)
        const sectionOverrides = page.id === currentPageId ? currentPageOverrides : undefined

        return (
          <article className="lesson-pdf-sheet" key={page.id}>
            <header className="lesson-pdf-header">
              <div className="lesson-pdf-brand">
                {/* Native image loading is reliable when the hidden print document becomes visible. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="lesson-pdf-logo"
                  src="/trulurn-icon.svg"
                  width={42}
                  height={42}
                  alt="TruLurn"
                />
                <div>
                  <strong>TruLurn</strong>
                  <span>AI-guided mastery</span>
                </div>
              </div>
              <div className="lesson-pdf-page-meta">
                <span>Lesson page {page.page_number} of {topicPageTotal}</span>
                <span>Course page {globalPageNumber} of {globalPageTotal}</span>
              </div>
              <div className="lesson-pdf-title">
                <span>Lesson</span>
                <h1>{topicTitle}</h1>
              </div>
            </header>

            {isStructured ? (
              <LessonSections
                sections={page.sections!}
                topicDepth={page.topic_depth}
                conceptKind={page.concept_kind}
                sectionOverrides={sectionOverrides}
              />
            ) : (
              <div className="lesson-body markdown-body">
                <MarkdownContent>{page.content}</MarkdownContent>
              </div>
            )}

            {page.source_citations?.length ? (
              <section className="lesson-source-citations lesson-pdf-sources">
                <strong>Sources used on this page</strong>
                <ol>
                  {page.source_citations.map((citation) => (
                    <li key={citation.citation_id}>
                      <strong>[{citation.citation_id}]</strong>{' '}
                      <span>{citation.source_title}</span>
                      {citation.heading_path.length ? (
                        <small>{citation.heading_path.join(' > ')}</small>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
