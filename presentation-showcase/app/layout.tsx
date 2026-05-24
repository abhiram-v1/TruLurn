import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TruLurn',
  description: 'AI-guided mastery system',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
