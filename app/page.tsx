import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { IconArrowRight } from '@tabler/icons-react'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

const NAV_ITEMS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Use Cases', href: '#use-cases' },
  { label: 'FAQ', href: '#faq' },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Start from a goal or your own material',
    body: 'Tell TruLurn what you want to learn, or hand it a PDF or notes you trust. That material becomes the backbone of the course instead of a generic syllabus.',
  },
  {
    step: '02',
    title: 'Get a structured course, not a transcript',
    body: 'Topics, dependencies, and lesson order are planned out before you read a word, then laid out as a connected Atlas you can see and navigate.',
  },
  {
    step: '03',
    title: 'Study with help that stays in context',
    body: 'Ask questions without losing your place. The doubt chat only knows the current lesson, so it answers and points you back instead of wandering off-topic.',
  },
  {
    step: '04',
    title: 'Prove it before you move on',
    body: 'Recall breaks and quizzes catch shaky understanding early, then update your map — mastered, functional, partial, or unstable.',
  },
]

const FEATURES = [
  {
    title: 'Curriculum from goals or source material',
    body: 'Start with a topic, a goal, or a document you trust. TruLurn plans the sequence, dependencies, and lesson flow around that instead of a generic syllabus.',
  },
  {
    title: 'The Atlas',
    body: 'Every course is a connected map of topics and prerequisites, not a flat list. You can always see where you are and what unlocks next.',
  },
  {
    title: 'Context-locked doubt chat',
    body: 'Ask questions mid-lesson without losing your place. The assistant only knows the current page, so it answers and steers you back instead of drifting into a generic chatbot.',
  },
  {
    title: 'Recall over re-reading',
    body: 'Recall breaks ask you to reconstruct an idea in your own words before moving on, instead of letting you scroll past it and assume it stuck.',
  },
  {
    title: 'Quizzes that check real understanding',
    body: 'Apply, explain, and spot-the-error questions are built to catch a right answer for the wrong reason, then feed straight back into your progress.',
  },
  {
    title: 'A map that tells the truth',
    body: 'Each topic is marked mastered, functional, partial, or unstable based on recall and quiz performance, never on time spent or pages completed.',
  },
]

const USE_CASES = [
  {
    audience: 'Self-learners',
    title: 'Go deep on any subject',
    body: 'Replace scattered videos and notes with a course that actually has sequence, depth, and a clear next step.',
  },
  {
    audience: 'Students',
    title: 'Study with structure, not panic',
    body: 'Turn a topic or your own notes into lessons, working definitions, and quick checkpoints you can run before an exam.',
  },
  {
    audience: 'Professionals',
    title: 'Pick up a new domain without losing your footing',
    body: 'Turn an unfamiliar tool or field into a focused course that respects what you already know.',
  },
  {
    audience: 'Educators and mentors',
    title: 'Prototype a course outline fast',
    body: 'Shape a learning path, surface concept dependencies, and pressure-test material before you teach it.',
  },
]

const FAQS = [
  {
    question: 'Is this just a chatbot with extra steps?',
    answer: 'No. Chat is one piece. TruLurn plans the course, builds a connected map of the topic, generates the lessons, and runs recall and quizzes. The doubt chat only answers questions inside whatever lesson you are currently on.',
  },
  {
    question: 'Can I use my own notes or source material?',
    answer: 'Yes. Point it at PDFs or notes you trust and that material becomes a hard boundary for the course. TruLurn organizes, sequences, and explains it, but will not invent content your source never covered.',
  },
  {
    question: 'What does "mastered" actually mean?',
    answer: 'Topic status — mastered, functional, partial, or unstable — comes from recall ratings and quiz performance, not from time spent or pages completed. Guessing right without being able to explain why gets caught instead of counted as progress.',
  },
  {
    question: 'Is TruLurn free to use right now?',
    answer: 'Yes. TruLurn is in beta, so the focus right now is feedback, not billing. Create an account and use the full product while it is being built.',
  },
]

export default async function LandingPage() {
  const session = await getServerSession(authOptions)
  const isSignedIn = Boolean(session?.user)
  const appHref = isSignedIn ? '/home' : '/auth/signin'
  const primaryLabel = isSignedIn ? 'Open product' : 'Start learning'

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
            <p className="landing-eyebrow">AI-guided mastery system</p>
            <h1>Most learning tools track completion. TruLurn tracks understanding.</h1>
            <p className="landing-hero-sub">
              Give it a topic or your own source material and it builds a structured course, maps every concept in a connected Atlas, then uses recall breaks and honest quizzes to catch shaky understanding before you build on top of it.
            </p>
            <div className="landing-hero-actions">
              <Link href={appHref} className="landing-btn-primary">
                {primaryLabel} <IconArrowRight size={17} stroke={2} aria-hidden="true" />
              </Link>
              <Link href="#how-it-works" className="landing-btn-ghost">
                See how it works
              </Link>
            </div>
            <div className="landing-proof-row" aria-label="Product highlights">
              <span>Source-grounded courses</span>
              <span>Context-locked chat</span>
              <span>A map that updates itself</span>
            </div>
          </div>

          <div className="landing-hero-card" aria-label="TruLurn product preview">
            <div className="landing-preview-top">
              <span className="landing-window-dot" />
              <span className="landing-window-dot" />
              <span className="landing-window-dot" />
              <strong>Course Atlas</strong>
            </div>
            <div className="landing-atlas-preview">
              <div className="landing-atlas-node is-active">Gradient Descent</div>
              <div className="landing-atlas-line" />
              <div className="landing-atlas-node">Loss Functions</div>
              <div className="landing-atlas-branch">
                <span>Batch</span>
                <span>Mini-batch</span>
                <span>Stochastic</span>
              </div>
            </div>
            <div className="landing-preview-note">
              <span>Next lesson</span>
              <p>Explain why step size changes whether learning converges, crawls, or explodes.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-how" id="how-it-works">
        <div className="landing-container">
          <div className="landing-section-header">
            <p className="landing-section-eyebrow">How it works</p>
            <h2>From a goal or a document to a course you can trust.</h2>
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
            <h2>Everything stays connected to the same course.</h2>
            <p>
              Lessons, chat, recall, and quizzes all read from the same course context, not six separate tools glued together.
            </p>
          </div>
          <div className="landing-features-grid">
            {FEATURES.map((feature, index) => (
              <article key={feature.title} className="landing-feature-card">
                <span className="landing-feature-index">{String(index + 1).padStart(2, '0')}</span>
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
            <p className="landing-section-eyebrow">Use cases</p>
            <h2>Built for more than one kind of learner.</h2>
            <p>
              Whether you are starting from zero, prepping for something specific, or turning trusted material into a real course, the structure holds up.
            </p>
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
            <p className="landing-section-eyebrow">Get access</p>
            <h2>Everything happens after you sign in.</h2>
            <p>
              Create a course, open its Atlas, and pick up any lesson exactly where you left off.
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
            <h2>What people ask before signing up.</h2>
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
            <h2>Built for understanding you can trust.</h2>
            <p>
              Most learning tools measure pages read, videos watched, time on screen. TruLurn tracks whether an idea actually landed: what you can apply, where you are still guessing, and what to study next.
            </p>
          </div>
          <div className="landing-contact-card">
            <span>Contact</span>
            <h3>Want to shape TruLurn for your workflow?</h3>
            <p>It is a small, active build. Run a real course through it, push on the parts that feel rough, and tell us what breaks. That feedback goes straight into what gets built next.</p>
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
            <p>Structured, source-aware courses that track understanding, not completion.</p>
          </div>

          <nav className="landing-footer-links" aria-label="Footer navigation">
            <Link href="#features">Features</Link>
            <Link href="#how-it-works">How it works</Link>
            <Link href="#use-cases">Use Cases</Link>
            <Link href="#faq">FAQ</Link>
            <Link href="#about">About</Link>
            <Link href="/auth/signin">Sign in</Link>
          </nav>

          <p className="landing-footer-copy">
            © {new Date().getFullYear()} TruLurn. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  )
}
