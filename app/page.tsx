export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { BottomNav } from '@/components/navigation/BottomNav'
import { TopicPill } from '@/components/ui/TopicPill'
import { AuthButtons } from '@/components/auth/AuthButtons'
import { getDb } from '@/lib/db'

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

type CourseRow = {
  _id: unknown
  title?: string
  topic?: string
  status?: string
  created_at?: Date
}

export default async function HomePage() {
  const session = await getServerSession(authOptions)
  const userId = session?.user ? (session.user as typeof session.user & { id?: string }).id : null
  const firstName = session?.user?.name?.split(' ')[0] ?? null
  const db = userId ? await getDb() : null
  const courses = userId && db
    ? await db.collection<CourseRow>('courses').find({ user_id: userId }).sort({ created_at: -1 }).toArray()
    : []
  const activeCourse = courses[0] ?? null
  const activeCourseId = activeCourse ? String(activeCourse._id) : undefined
  const branches = activeCourseId && db
    ? await db.collection('branches').find({ course_id: activeCourseId }).toArray()
    : []
  const topics = activeCourseId && db
    ? await db.collection('topics').find({ course_id: activeCourseId }).toArray()
    : []
  const activeTopic = topics.find((topic) => topic.state === 'active') ?? topics[0]
  const activeTopicId = activeTopic ? String(activeTopic._id) : null

  return (
    <main className="home-split-shell">
      <section className="home-course-pane">
        <header className="home-pane-topbar">
          <Link className="brand" href="/">TruLurn</Link>
          <div className="home-topbar-right">
            <Link className="button-subtle" href="/setup">+ New course</Link>
            <AuthButtons />
          </div>
        </header>

        <div className="home-greeting">
          <h1>{userId ? `${timeGreeting()}${firstName ? `, ${firstName}` : ''}` : 'Build learning that stays connected'}</h1>
          <p>{userId ? 'Pick up where you left off.' : 'Sign in to generate and save isolated course workspaces.'}</p>
        </div>

        <div className="section-label">Your courses</div>
        <div className="home-course-list">
          {!userId ? (
            <div className="empty-course-state">
              <p>Generated courses are stored under your account. Sign in first, then create your first roadmap.</p>
              <div className="empty-course-actions">
                <Link className="button" href="/auth/signin">Sign in</Link>
                <Link className="button-subtle" href="/auth/signin">Sign up</Link>
              </div>
            </div>
          ) : null}

          {userId && courses.length === 0 ? (
            <div className="empty-course-state">
              <p>No generated courses yet. Create one and it will appear here permanently.</p>
              <Link className="button" href="/setup">Build a curriculum</Link>
            </div>
          ) : null}

          {courses.map((course) => {
            const courseId = String(course._id)
            const isActive = courseId === activeCourseId
            const branchCount = isActive ? branches.length : undefined

            return (
              <Link className="home-course-row" href={`/course/${courseId}`} key={courseId}>
                <span className={`state-dot ${course.status === 'ready' ? 'active' : 'partial'}`} />
                <span className="home-course-copy">
                  <span className="course-title">{course.topic ?? course.title ?? 'Untitled course'}</span>
                  <span className="course-meta">
                    {course.title ?? 'Generated curriculum'}{branchCount !== undefined ? ` / ${branchCount} branches` : ''}
                  </span>
                </span>
                <TopicPill state={course.status === 'ready' ? 'active' : 'partial'} />
              </Link>
            )
          })}

          {userId ? (
            <Link className="home-add-course" href="/setup">
              <span aria-hidden="true">+</span>
              <span>Add a course</span>
            </Link>
          ) : null}
        </div>

        {activeCourseId ? (
          <div className="home-pane-footer">
            <Link href={`/course/${activeCourseId}`}>Big roadmap</Link>
            {activeTopicId ? <Link href={`/learn/${activeCourseId}/${activeTopicId}`}>Continue study</Link> : null}
          </div>
        ) : null}
      </section>

      <section className="home-visual-pane" aria-label="Course visual preview">
        <div className="home-wave" aria-hidden="true">
          <svg viewBox="0 0 96 900" preserveAspectRatio="none">
            <path d="M0 0H40C74 92 78 168 48 246C18 324 20 404 54 486C88 568 80 648 38 726C12 774 8 834 34 900H0V0Z" />
          </svg>
        </div>
        <div className="home-seam" aria-hidden="true">
          <span>v</span>
        </div>
        <img
          className="visual-artwork"
          src="/svggenie-1779268612546.svg"
          alt="Warm study illustration"
        />
        <div className="continue-strip">
          <div>
            <span className="eyebrow">{activeCourse ? 'Continue' : 'Start'}</span>
            <p>
              {activeCourse && activeTopic
                ? `${activeCourse.topic ?? activeCourse.title} / ${activeTopic.title}`
                : 'Create your first stored course workspace'}
            </p>
          </div>
          <Link className="button" href={activeCourseId && activeTopicId ? `/learn/${activeCourseId}/${activeTopicId}` : '/setup'}>
            {activeCourse ? 'Open' : 'New'}
          </Link>
        </div>
      </section>

      <BottomNav courseId={activeCourseId} />
    </main>
  )
}
