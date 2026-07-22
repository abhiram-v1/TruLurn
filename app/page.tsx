import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  IconArrowRight,
  IconFileText,
  IconMap,
  IconMessage,
  IconRefresh,
  IconClipboardCheck,
  IconChartDots,
} from '@tabler/icons-react'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

const NAV_ITEMS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Who it’s for', href: '#use-cases' },
  { label: 'FAQ', href: '#faq' },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Pick a topic or upload your material',
    body: 'Type what you want to learn, or upload the PDFs and notes you already have. The course is built from that.',
  },
  {
    step: '02',
    title: 'Get a structured course',
    body: 'Topics are ordered by prerequisites and laid out on a map, so you can see what comes next and why.',
  },
  {
    step: '03',
    title: 'Ask questions as you read',
    body: 'A chat panel sits beside every lesson. It knows the page you’re on, so answers match what you’re reading.',
  },
  {
    step: '04',
    title: 'Test yourself before moving on',
    body: 'Short quizzes and recall checks close out each topic. Your map updates to show what’s solid and what needs another pass.',
  },
]

const FEATURES = [
  {
    icon: IconFileText,
    title: 'Courses from your own material',
    body: 'Upload PDFs or notes and the course is built strictly from them. TruLurn organizes and explains your source — it doesn’t invent content your material never covered.',
  },
  {
    icon: IconMap,
    title: 'The course Atlas',
    body: 'Every course is a connected map of topics and prerequisites. You can always see where you are, what you’ve covered, and what unlocks next.',
  },
  {
    icon: IconMessage,
    title: 'Lesson-aware chat',
    body: 'Ask questions without leaving the page. The chat reads the lesson you’re on and answers in that context instead of drifting off-topic.',
  },
  {
    icon: IconRefresh,
    title: 'Recall checks',
    body: 'Short prompts ask you to explain an idea in your own words before you move on — a far better signal than having read the page.',
  },
  {
    icon: IconClipboardCheck,
    title: 'Quizzes with real feedback',
    body: 'Apply, explain, and spot-the-error questions. Results come back as specific gaps to fix, not just a score.',
  },
  {
    icon: IconChartDots,
    title: 'Progress based on performance',
    body: 'Each topic is marked mastered, functional, partial, or unstable from quiz and recall results — never from time spent or pages read.',
  },
]

const USE_CASES = [
  {
    audience: 'Self-learners',
    title: 'Learn a subject properly',
    body: 'Replace scattered videos and articles with one course that has a clear order and an end.',
  },
  {
    audience: 'Students',
    title: 'Prepare for exams',
    body: 'Turn a syllabus or your own notes into lessons and checkpoints you can run before a test.',
  },
  {
    audience: 'Professionals',
    title: 'Pick up a new domain',
    body: 'Get up to speed on an unfamiliar field or tool without sitting through a beginner course.',
  },
  {
    audience: 'Educators',
    title: 'Draft course outlines',
    body: 'Map concept dependencies and check how material sequences before you teach it.',
  },
]

const FAQS = [
  {
    question: 'Is this just a chatbot with extra steps?',
    answer: 'No. Chat is one part of it. TruLurn plans the course, builds the topic map, writes the lessons, and runs recall checks and quizzes. The chat only answers questions about the lesson you’re currently on.',
  },
  {
    question: 'Can I use my own notes or source material?',
    answer: 'Yes. Upload PDFs or notes and they become the boundary for the course. TruLurn organizes, sequences, and explains your material, but won’t add content it doesn’t cover.',
  },
  {
    question: 'What does “mastered” actually mean?',
    answer: 'Topic status comes from your recall and quiz performance, not from time spent or pages completed. If you guess right but can’t explain why, that gets caught rather than counted as progress.',
  },
  {
    question: 'Is TruLurn free to use right now?',
    answer: 'Yes. TruLurn is in beta, so the focus is feedback rather than billing. Create an account and use the full product.',
  },
]

export default async function LandingPage() {
  const session = await getServerSession(authOptions)
  const isSignedIn = Boolean(session?.user)
  const appHref = isSignedIn ? '/home' : '/auth/signin'
  const primaryLabel = isSignedIn ? 'Open TruLurn' : 'Start learning'

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Public website navigation">
        <div className="landing-container landing-nav-inner">
          <Link href="/" className="landing-brand" aria-label="TruLurn home">
            <TruLurnLogo size={26} className="landing-brand-icon" />
            <span>TruLurn</span>
          </Link>

          <div className="landing-nav-links" aria-label="Landing page sections">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>

          <div className="landing-nav-actions">
            {isSignedIn ? (
              <Link href="/home" className="landing-nav-cta">
                Open app <IconArrowRight size={15} stroke={2} aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link href="/auth/signin" className="landing-nav-link">Sign in</Link>
                <Link href="/auth/signin" className="landing-nav-cta">Get started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy">
            <h1>How much of what you study actually sticks?</h1>
            <p className="landing-hero-sub">
              TruLurn turns a topic or your own notes into a structured course — lessons in the right order, a map of how concepts connect, and quick checks that show what you’ve actually retained.
            </p>
            <div className="landing-hero-actions">
              <Link href={appHref} className="landing-btn-primary">
                {primaryLabel} <IconArrowRight size={17} stroke={2} aria-hidden="true" />
              </Link>
              <Link href="#how-it-works" className="landing-btn-ghost">
                See how it works
              </Link>
            </div>
            <p className="landing-hero-note">Free during beta &middot; No credit card &middot; Works with your own material</p>
          </div>

          <div className="landing-hero-card" aria-label="TruLurn app preview">
            <div className="landing-preview-chrome">
              <span className="landing-window-dot" />
              <span className="landing-window-dot" />
              <span className="landing-window-dot" />
              <strong>Gradient Descent &mdash; page 3 of 7</strong>
            </div>
            <div className="landing-preview-body">
              <div className="landing-preview-rail" aria-hidden="true">
                <span className="landing-preview-label">Course</span>
                <div className="landing-rail-row"><i className="landing-dot is-mastered" />Linear Regression</div>
                <div className="landing-rail-row"><i className="landing-dot is-functional" />Loss Functions</div>
                <div className="landing-rail-row is-current"><i className="landing-dot is-active" />Gradient Descent</div>
                <div className="landing-rail-row is-locked"><i className="landing-dot" />Backpropagation</div>
                <div className="landing-rail-row is-locked"><i className="landing-dot" />Optimizers</div>
              </div>
              <div className="landing-preview-lesson" aria-hidden="true">
                <h4>Why step size matters</h4>
                <span className="landing-line" style={{ width: '100%' }} />
                <span className="landing-line" style={{ width: '94%' }} />
                <span className="landing-line" style={{ width: '78%' }} />
                <div className="landing-preview-callout">
                  <span>Recall check</span>
                  <p>Explain what happens when the learning rate is set too high.</p>
                </div>
                <span className="landing-line" style={{ width: '96%' }} />
                <span className="landing-line" style={{ width: '62%' }} />
              </div>
              <div className="landing-preview-chat" aria-hidden="true">
                <span className="landing-preview-label">Doubt chat</span>
                <div className="landing-chat-bubble is-user">Why does it overshoot the minimum?</div>
                <div className="landing-chat-bubble">
                  <span className="landing-line" style={{ width: '100%' }} />
                  <span className="landing-line" style={{ width: '86%' }} />
                  <span className="landing-line" style={{ width: '55%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-how" id="how-it-works">
        <div className="landing-container">
          <div className="landing-section-header">
            <p className="landing-section-eyebrow">How it works</p>
            <h2>From topic to course in four steps.</h2>
          </div>
          <div className="landing-how-grid">
            {HOW_IT_WORKS.map((item) => (
              <article key={item.step} className="landing-how-item">
                <span className="landing-how-step">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="landing-container">
          <div className="landing-section-header">
            <p className="landing-section-eyebrow">Features</p>
            <h2>Everything works from the same course.</h2>
            <p>
              Lessons, chat, recall, and quizzes all share the same course context. Nothing is a separate tool bolted on.
            </p>
          </div>
          <div className="landing-features-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="landing-feature-card">
                <span className="landing-feature-icon">
                  <feature.icon size={18} stroke={1.75} aria-hidden="true" />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-use-cases" id="use-cases">
        <div className="landing-container">
          <div className="landing-section-header landing-section-header-center">
            <p className="landing-section-eyebrow">Who it&rsquo;s for</p>
            <h2>Different starting points, same structure.</h2>
          </div>
          <div className="landing-use-grid">
            {USE_CASES.map((useCase) => (
              <article key={useCase.audience} className="landing-use-card">
                <span>{useCase.audience}</span>
                <h3>{useCase.title}</h3>
                <p>{useCase.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-cta-band">
        <div className="landing-container landing-cta-band-inner">
          <div>
            <h2>Start your first course.</h2>
            <p>
              Sign in, describe what you want to learn or upload your material, and TruLurn builds the course. Free while in beta.
            </p>
          </div>
          <Link href={appHref} className="landing-btn-primary">
            {primaryLabel} <IconArrowRight size={17} stroke={2} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="landing-faq" id="faq">
        <div className="landing-container">
          <div className="landing-section-header landing-section-header-center">
            <p className="landing-section-eyebrow">FAQ</p>
            <h2>Common questions.</h2>
          </div>
          <div className="landing-faq-list">
            {FAQS.map((faq) => (
              <article key={faq.question} className="landing-faq-item">
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-about-contact" id="about">
        <div className="landing-container landing-about-grid">
          <div>
            <p className="landing-section-eyebrow">About</p>
            <h2>Why TruLurn exists.</h2>
            <p>
              Most learning tools measure pages read, videos watched, and time on screen. None of that says whether an idea landed. TruLurn tracks what you can apply, where you’re still guessing, and what to study next.
            </p>
          </div>
          <div className="landing-contact-card">
            <span>Feedback</span>
            <h3>TruLurn is in active development.</h3>
            <p>Run a real course through it. If something breaks or feels wrong, say so &mdash; feedback decides what gets built next.</p>
            <Link href={appHref} className="landing-btn-ghost">Open TruLurn</Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-footer-brand-block">
            <Link href="/" className="landing-footer-brand">
              <TruLurnLogo size={24} />
              TruLurn
            </Link>
            <p>Structured courses from your goals or your material, with progress based on what you can actually recall.</p>
          </div>

          <nav className="landing-footer-links" aria-label="Footer navigation">
            <Link href="#features">Features</Link>
            <Link href="#how-it-works">How it works</Link>
            <Link href="#use-cases">Who it&rsquo;s for</Link>
            <Link href="#faq">FAQ</Link>
            <Link href="#about">About</Link>
            <Link href="/auth/signin">Sign in</Link>
          </nav>

          <p className="landing-footer-copy">
            &copy; {new Date().getFullYear()} TruLurn. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  )
}
