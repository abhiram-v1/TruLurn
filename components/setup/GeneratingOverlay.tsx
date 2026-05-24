'use client'

import { useEffect, useState } from 'react'

const QUOTES = [
  'Creating the course record...',
  'Reading your learning goals...',
  'Building the primary roadmap...',
  'Resolving prerequisites...',
  'Storing course modules...',
  'Saving topic summaries...',
  'Preparing the course workspace...',
  'Connecting the first active topic...',
]

export function GeneratingOverlay({ progress }: { progress: number }) {
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => {
        setQuoteIndex((index) => (index + 1) % QUOTES.length)
        setVisible(true)
      }, 260)
    }, 2200)

    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="gen-overlay" role="status" aria-live="polite" aria-label="Generating curriculum">
      <div className="gen-card">
        <div className="gen-loader-wrap" aria-hidden="true">
          <div className="gen-ripples">
            <span />
            <span />
            <span />
          </div>
          <div className="gen-blob" />
        </div>

        <p className="gen-quote" style={{ opacity: visible ? 1 : 0 }}>
          {QUOTES[quoteIndex]}
        </p>

        <div className="gen-progress-wrap">
          <div className="gen-progress-track" aria-label={`${progress}% complete`}>
            <div className="gen-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="gen-progress-pct">{progress}%</span>
        </div>
      </div>
    </div>
  )
}
