import type { Metadata } from 'next'
import { Suspense } from 'react'
import 'katex/dist/katex.min.css'
import './globals.css'
import './styles/landing.css'
import './styles/pages.css'
import './styles/generation.css'
import './styles/content.css'
import './styles/study.css'
import './styles/lesson-images.css'
import './styles/curriculum.css'
import './styles/roadmap.css'
import './styles/auth.css'
import './styles/study-workspace.css'
import './styles/graph.css'
import './styles/theme.css'
import './styles/recall.css'
import './styles/palette-details.css'
import './styles/print.css'
import { SessionProvider } from '@/components/providers/SessionProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { NavigationFeedback } from '@/components/navigation/NavigationFeedback'

const themeScript = `
  (function () {
    try {
      var storedTheme = localStorage.getItem('trulurn-theme');
      var theme = storedTheme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.colorScheme = 'light';
    }
  })();
`

export const metadata: Metadata = {
  title: 'TruLurn',
  description: 'AI-guided mastery system',
  icons: {
    icon: [{ url: '/trulurn-icon.svg', type: 'image/svg+xml' }],
    shortcut: '/trulurn-icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <SessionProvider>
            <Suspense fallback={null}>
              <NavigationFeedback />
            </Suspense>
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
