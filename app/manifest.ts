import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TruLurn',
    short_name: 'TruLurn',
    description: 'AI-guided mastery system',
    start_url: '/',
    display: 'standalone',
    background_color: '#fdf7ed',
    theme_color: '#02030d',
    icons: [
      {
        src: '/trulurn-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
