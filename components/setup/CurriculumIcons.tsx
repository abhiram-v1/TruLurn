// TruLurn curriculum-builder icon set — concept-specific line icons.
// viewBox 24, 1.8px stroke, round joins. Only the icons the builder actually
// uses are kept (source / progression / configuration). Decorative or
// unused-section icons from the source set were intentionally dropped.

import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Glyph({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

// ── generic ──
export const IcCheckSm = (p: IconProps) => <Glyph {...p}><path d="M20 6L9 17l-5-5" /></Glyph>
export const IcCheck = (p: IconProps) => <Glyph {...p}><path d="M5 12.5l5 5 9-11" /></Glyph>
export const IcWarn = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M10.3 4L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4" />
    <path d="M12 16.7h.01" />
  </Glyph>
)

// ── content source ──
export const IcDoc = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 3h6l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4" />
    <path d="M10 12.5h5" />
    <path d="M10 16h5" />
  </Glyph>
)
export const IcRobot = (p: IconProps) => (
  <Glyph {...p}>
    <rect x={4} y={5} width={16} height={14} rx={5} />
    <path d="M12 8.6l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" />
  </Glyph>
)

// ── progression ──
export const IcRoute = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 19c0-4 5-4.5 6-7s5-3 6-7" />
    <circle cx={6} cy={19} r={1.9} />
    <circle cx={18} cy={5} r={1.9} />
    <circle cx={12} cy={12} r={1.3} />
  </Glyph>
)
export const IcBalance = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 4v14" />
    <path d="M8.5 18h7" />
    <path d="M5 8h14" />
    <path d="M5 8L3 12.2q2 2 4 0L5 8z" />
    <path d="M19 8l-2 4.2q2 2 4 0L19 8z" />
    <circle cx={12} cy={5} r={0.9} />
  </Glyph>
)
export const IcExpand = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 10V4" />
    <path d="M9.5 6L12 3.5 14.5 6" />
    <path d="M12 14v6" />
    <path d="M9.5 18L12 20.5 14.5 18" />
    <path d="M10 12H4" />
    <path d="M6 9.5L3.5 12 6 14.5" />
    <path d="M14 12h6" />
    <path d="M18 9.5L20.5 12 18 14.5" />
    <circle cx={12} cy={12} r={1} />
  </Glyph>
)

// ── detail level ──
export const IcEye = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 12C5 7.6 8.4 5.6 12 5.6s7 2 9.5 6.4C19 16.4 15.6 18.4 12 18.4S5 16.4 2.5 12z" />
    <circle cx={12} cy={12} r={2.6} />
  </Glyph>
)
export const IcBook = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 6.5C10 5 7.5 5 5 6v11.5c2.5-1 5-1 7 .5" />
    <path d="M12 6.5C14 5 16.5 5 19 6v11.5c-2.5-1-5-1-7 .5" />
    <path d="M12 6.5V18" />
  </Glyph>
)
export const IcGem = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 9l3-4h6l3 4-6 11z" />
    <path d="M6 9h12" />
    <path d="M9 5l3 4 3-4" />
    <path d="M12 9v11" />
  </Glyph>
)

// ── knowledge level ──
export const IcSprout = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 20v-9" />
    <path d="M12 13c-2.5 0-4.5-2-4.5-4.8C10 8.2 12 10 12 12.8" />
    <path d="M12 11.5c0-2.5 2-4.5 4.5-4.5C16.5 9.8 14.5 11.5 12 11.5z" />
  </Glyph>
)
export const IcBolt = (p: IconProps) => <Glyph {...p}><path d="M13 3L5 13.5h6L10.5 21 19 10h-6.5z" /></Glyph>
export const IcSummit = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 19L9.5 8l3.5 5.5L16 9l5 10z" />
    <path d="M9.5 8V4.5" />
    <path d="M9.5 4.5h3.2l-1.2 1.5 1.2 1.5H9.5" />
  </Glyph>
)

// ── focus / purpose ──
export const IcCompass = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx={12} cy={12} r={8.5} />
    <path d="M15.5 8.5L13 13l-4.5 2.5L11 11z" />
    <circle cx={12} cy={12} r={0.6} />
  </Glyph>
)
export const IcTool = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M14.7 6.3a4 4 0 0 0-5 5L4.2 16.8a1.6 1.6 0 0 0 2.3 2.3l5.5-5.5a4 4 0 0 0 5-5l-2.7 2.7-2.5-2.5z" />
  </Glyph>
)
export const IcFlask = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9.5 3h5" />
    <path d="M10.5 3v6l-5 8.5A1.5 1.5 0 0 0 6.8 20h10.4a1.5 1.5 0 0 0 1.3-2.5L13.5 9V3" />
    <path d="M8 14.5h8" />
    <circle cx={11} cy={16.6} r={0.7} />
    <circle cx={14} cy={18} r={0.7} />
  </Glyph>
)

// ── build bar ──
export const IcMap = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z" />
    <path d="M9 4v14" />
    <path d="M15 6v14" />
  </Glyph>
)
