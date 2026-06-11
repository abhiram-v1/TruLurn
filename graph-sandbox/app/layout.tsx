import type { Metadata } from 'next'
import '../../app/globals.css'

export const metadata: Metadata = {
  title: 'TruLurn Graph Sandbox',
  description: 'Non-persistent curriculum and knowledge graph testing.',
}

export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
