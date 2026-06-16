export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AuthButtons } from '@/components/auth/AuthButtons'
import { HomeCourseRow } from '@/components/home/HomeCourseRow'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'
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
  goals?: string
  status?: string
  branch_count?: number
  topic_count?: number
  created_at?: Date
}

function isRawPrompt(value?: string | null) {
  if (!value) return false
  const clean = value.trim()
  return clean.length > 90 || clean.split(/\s+/).length > 12
}

function titleFromPrompt(value?: string | null) {
  const clean = value
    ?.replace(/^i\s+want\s+to\s+learn\s+/i, '')
    .replace(/^learn\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim() ?? ''
  const sentence = clean.split(/[.!?]/)[0]?.trim() || clean
  const fromMatch = sentence.match(/^(.+?)\s+from\s+(first principles|scratch|basics|fundamentals)\b/i)

  if (fromMatch) {
    const subject = fromMatch[1].replace(/\b(the|a|an)\b/gi, '').trim()
    const qualifier = fromMatch[2]
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
    return `${subject} from ${qualifier}`.replace(/\s+/g, ' ').trim()
  }

  return sentence.split(/\s+/).slice(0, 6).join(' ').replace(/[,;:]$/, '').trim()
}

function courseDisplayTitle(course?: CourseRow | null) {
  if (!course) return 'Generated curriculum'
  const generatedTitle = course.title?.trim()
  const legacyTopic = course.topic?.trim()

  if (legacyTopic && !isRawPrompt(legacyTopic)) return legacyTopic
  if (generatedTitle && !isRawPrompt(generatedTitle)) return generatedTitle
  const derivedTitle = titleFromPrompt(course.goals ?? legacyTopic ?? generatedTitle)
  if (derivedTitle) return derivedTitle
  return 'Generated curriculum'
}

function courseMeta(course: CourseRow, branchCount?: number) {
  const title = courseDisplayTitle(course)
  const generatedTitle = course.title?.trim()
  const parts: string[] = []

  if (generatedTitle && generatedTitle !== title && !isRawPrompt(generatedTitle)) {
    parts.push(generatedTitle)
  }
  if (branchCount !== undefined) {
    parts.push(`${branchCount} branches`)
  }

  return parts.length ? parts.join(' / ') : 'Course workspace'
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
          <Link className="brand" href="/" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <TruLurnLogo size={22} />
            TruLurn
          </Link>
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
              <p>Generated courses are stored under your account. Sign in first, then create your first Atlas.</p>
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
            const branchCount = isActive ? branches.length : course.branch_count
            const title = courseDisplayTitle(course)

            return (
              <HomeCourseRow
                courseId={courseId}
                key={courseId}
                meta={courseMeta(course, branchCount)}
                status={course.status === 'ready' ? 'active' : 'partial'}
                title={title}
              />
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
            <Link href={`/course/${activeCourseId}`}>Atlas</Link>
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
        <img
          className="visual-artwork"
          src="/svggenie-1779268612546.svg"
          alt="Warm study illustration"
        />
        <div className="home-visual-note" aria-hidden="true">
          <span>{courses.length || 'New'}</span>
          <p>{courses.length === 1 ? 'course workspace' : courses.length > 1 ? 'course workspaces' : 'workspace ready'}</p>
        </div>
        <div className="continue-strip">
          <div>
            <span className="eyebrow">{activeCourse ? 'Continue' : 'Start'}</span>
            <p>
              {activeCourse && activeTopic
                ? `${courseDisplayTitle(activeCourse)} / ${activeTopic.title}`
                : 'Create your first stored course workspace'}
            </p>
          </div>
          <Link className="button" href={activeCourseId && activeTopicId ? `/learn/${activeCourseId}/${activeTopicId}` : '/setup'}>
            {activeCourse ? 'Open' : 'New'}
          </Link>
        </div>
      </section>
    </main>
  )
}
