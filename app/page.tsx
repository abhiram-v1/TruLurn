import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  IconBrain,
  IconMap,
  IconMessageChatbot,
  IconRotateClockwise,
  IconTopologyStar3,
  IconTarget,
  IconArrowRight,
} from '@tabler/icons-react'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

const FEATURES = [
  {
    icon: <IconBrain size={22} stroke={1.6} />,
    title: 'Curriculum built for you',
    body: 'Describe what you want to learn. TruLurn generates a structured Atlas — a full map of branches and topics calibrated to your knowledge level and goals, not a generic syllabus.',
  },
  {
    icon: <IconMap size={22} stroke={1.6} />,
    title: 'Atlas course map',
    body: 'A visual map of your entire curriculum. See exactly where you are, what\'s next, and how far you\'ve come — all in one place.',
  },
  {
    icon: <IconMessageChatbot size={22} stroke={1.6} />,
    title: 'Smart doubt chat',
    body: 'Ask any question mid-lesson. TruLurn answers in the direct context of the page you just read — not a generic AI assistant response.',
  },
  {
    icon: <IconRotateClockwise size={22} stroke={1.6} />,
    title: 'Recall breaks',
    body: 'Active retrieval sessions prompt you to reconstruct what you\'ve learned. Recall — not re-reading — is what builds memory that stays.',
  },
  {
    icon: <IconTopologyStar3 size={22} stroke={1.6} />,
    title: 'Knowledge graph',
    body: 'A growing visual map of how every concept connects to every other. Spot gaps, revisit weak spots, and watch mastery compound over time.',
  },
  {
    icon: <IconTarget size={22} stroke={1.6} />,
    title: 'Adaptive quizzes',
    body: 'Quizzes diagnose what you actually understand, not just what you remember. Wrong answers feed back into the system to re-teach precisely.',
  },
]

const HOW_IT_WORKS = [
  {
    num: '1',
    title: 'Tell TruLurn what you want to learn',
    body: 'Type a topic, a learning goal, or paste a source document. No rigid course catalogue. No prerequisite structures. Just what you actually want to understand.',
  },
  {
    num: '2',
    title: 'Get your personal Atlas',
    body: 'AI builds a complete curriculum in seconds — branches, topics, and a page-by-page lesson plan — calibrated to your stated knowledge level and purpose.',
  },
  {
    num: '3',
    title: 'Study with full AI support',
    body: 'Adaptive lessons, mid-lesson doubt chat, spaced recall breaks, and progress quizzes all work together as you learn. The system updates as you do.',
  },
]

export default async function LandingPage() {
  const session = await getServerSession(authOptions)
  const isSignedIn = Boolean(session?.user)

  const ctaHref = isSignedIn ? '/home' : '/auth/signin'
  const ctaLabel = isSignedIn ? 'Open your dashboard' : 'Start learning free'

  return (
    <div className="landing-shell">

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <Link href="/" className="landing-brand">
            <TruLurnLogo size={26} className="landing-brand-icon" />
            TruLurn
          </Link>
          <div className="landing-nav-actions">
            {isSignedIn ? (
              <Link href="/home" className="landing-nav-cta">
                Dashboard <IconArrowRight size={14} stroke={2} aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link href="/auth/signin" className="landing-nav-link">Sign in</Link>
                <Link href="/auth/signin" className="landing-nav-cta">Get started free</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-container landing-hero-inner">
          <div className="landing-eyebrow">AI-Guided Mastery System</div>
          <h1 className="landing-headline">
            Learn anything.<br />Own it completely.
          </h1>
          <p className="landing-hero-sub">
            TruLurn builds you a personalized curriculum, teaches it page by page with
            adaptive AI, and uses science-backed recall techniques to make what you
            learn actually stick.
          </p>
          <div className="landing-hero-actions">
            <Link href={ctaHref} className="landing-btn-primary">
              {ctaLabel}
            </Link>
            <Link href="#how-it-works" className="landing-btn-ghost">
              See how it works
            </Link>
          </div>
          <p className="landing-hero-note">
            No credit card · Works for any subject · Fully personalized
          </p>
        </div>
      </section>

      {/* ── Trust strip ────────────────────────────────────────────────────── */}
      <div className="landing-trust">
        <div className="landing-container">
          <p>
            Not another video platform. Not generic study notes. A personalized tutor
            that builds a complete learning system around your specific goals — and
            remembers what you know.
          </p>
        </div>
      </div>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section className="landing-features" id="features">
        <div className="landing-container">
          <div className="landing-section-eyebrow">What TruLurn gives you</div>
          <h2 className="landing-section-head">
            Everything a private tutor would do — at scale
          </h2>
          <div className="landing-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon" aria-hidden="true">{f.icon}</div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section className="landing-how" id="how-it-works">
        <div className="landing-container">
          <div className="landing-section-eyebrow">How TruLurn works</div>
          <h2 className="landing-section-head">
            From goal to mastery in three steps
          </h2>
          <div className="landing-steps">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.num} className="landing-step">
                {i > 0 && <div className="landing-step-connector" aria-hidden="true" />}
                <div className="landing-step-body">
                  <div className="landing-step-num" aria-hidden="true">{step.num}</div>
                  <h3 className="landing-step-title">{step.title}</h3>
                  <p className="landing-step-desc">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="landing-cta">
        <div className="landing-container landing-cta-inner">
          <h2 className="landing-cta-head">
            Ready to learn something that sticks?
          </h2>
          <p className="landing-cta-sub">
            Tell TruLurn what you want to master. Your personal Atlas is ready in seconds.
          </p>
          <Link href={ctaHref} className="landing-btn-primary landing-btn-lg">
            {isSignedIn ? 'Go to your dashboard →' : 'Create your first Atlas →'}
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div>
            <div className="landing-footer-brand">TruLurn</div>
            <p className="landing-footer-tagline">AI-guided mastery system</p>
          </div>
          <nav className="landing-footer-links" aria-label="Footer">
            <Link href="/auth/signin">Sign in</Link>
            <Link href="/auth/signin">Sign up</Link>
          </nav>
          <p className="landing-footer-copy">
            © {new Date().getFullYear()} TruLurn. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  )
}
