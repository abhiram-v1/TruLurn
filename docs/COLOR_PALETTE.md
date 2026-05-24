# TruLurn — Color Palette & Design Tokens

> Source of truth for all colors. Do not use any color not listed here (except semantic topic states).

---

## Brand Palette

Exported from Coolors: `#050517 · #d36d4a · #f4e3b2 · #fdf7ed · #d3d5d7`

| Token | Hex | Usage |
|---|---|---|
| `--color-bg-primary` | `#fdf7ed` | Page background, card backgrounds |
| `--color-bg-secondary` | `#f4e3b2` | Hover states, subtle section fills, sand tones |
| `--color-text-primary` | `#050517` | All body text, headings, labels |
| `--color-accent` | `#d36d4a` | Primary action buttons, active indicators, accent marks |
| `--color-border` | `#d3d5d7` | All borders (use 0.5px–1px thickness only) |
| `--color-text-secondary` | `#7a7a7a` | Secondary text, meta info, timestamps (derived, not in palette) |

---

## Topic State Colors (Semantic Only)

These are the only additional colors allowed. They appear only on topic pills/dots in the roadmap.

| State | Background | Text/Dot |
|---|---|---|
| Mastered | `#EAF3DE` | `#3B6D11` (green) |
| Partial | `#FAEEDA` | `#854F0B` (amber) |
| Functional | `#E6F1FB` | `#185FA5` (blue) |
| Unstable | `#FDE8E8` | `#B91C1C` (red) |

---

## CSS Variables (globals.css)

```css
:root {
  --color-bg-primary:    #fdf7ed;
  --color-bg-secondary:  #f4e3b2;
  --color-text-primary:  #050517;
  --color-accent:        #d36d4a;
  --color-border:        #d3d5d7;
  --color-text-secondary: #7a7a7a;

  /* Typography */
  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 15px;
  --text-lg:   18px;
  --text-xl:   22px;
  --text-2xl:  28px;

  /* Spacing */
  --border-radius-sm: 4px;
  --border-radius-md: 6px;
  --border-radius-lg: 10px;
}
```

---

## Tailwind Config Mapping

```js
// tailwind.config.ts
colors: {
  bg: {
    primary:   '#fdf7ed',
    secondary: '#f4e3b2',
  },
  ink: {
    primary:   '#050517',
    secondary: '#7a7a7a',
  },
  accent:  '#d36d4a',
  border:  '#d3d5d7',
}
```

---

## What Is Forbidden

- Purple, violet, indigo (any shade)
- Neon colors on dark backgrounds
- Gradients of any kind (background, text, border)
- Glassmorphism / frosted glass / backdrop blur as a style
- Multiple competing accent colors
- Shadows heavier than `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`

---

## Design Reference

The homepage mockup (`trulurn_home_warm.html`) is the visual north star.  
The right panel of the homepage shows the cozy warm library aesthetic:  
dark backgrounds (`#1C1510`), warm amber book spines, candlelight — this is the *vibe*, not the UI chrome.  
The UI chrome (left panel in the mockup) is the pattern: white/cream surfaces, minimal borders, no decoration.
