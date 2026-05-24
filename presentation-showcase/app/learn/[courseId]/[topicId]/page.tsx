import { LearnExperience } from '@/components/learn/LearnExperience'
import { getPages, getTopic, mockDoubts, mockTopics } from '@/lib/mock-data'

export default function LearnTopicPage({
  params,
  searchParams,
}: {
  params: { courseId: string; topicId: string }
  searchParams?: { page?: string }
}) {
  const topic = getTopic(params.topicId)
  const pages = getPages(topic.id)
  const requestedPage = Number(searchParams?.page ?? '1')
  const safePage = Math.min(Math.max(requestedPage, 1), pages.length)
  const page = pages[safePage - 1]

  return (
    <LearnExperience
      courseId={params.courseId}
      topic={topic}
      topics={mockTopics}
      page={page}
      totalPages={pages.length}
      initialMessages={mockDoubts.filter((message) => message.topic_id === topic.id)}
    />
  )
}
