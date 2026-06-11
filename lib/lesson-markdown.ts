// ── Math detection ─────────────────────────────────────────────────────────

/** Loose heuristic — matches backtick math like `f(x)` */
function isMathLike(value: string) {
  return /\\|lim|sqrt|frac|sum|int|->|→|[=^_]|[ƒ∫∞≤≥≠]/i.test(value)
}

/** Strict heuristic — only matches unambiguously mathematical italic spans */
function isMathLikeStrict(value: string) {
  return /→|\\|lim\s*\(|sqrt\s*\(|∫|∞|≤|≥|≠/.test(value)
}

// ── Unicode → LaTeX substitution map ──────────────────────────────────────

function applyUnicodeSubstitutions(value: string) {
  return value
    .replaceAll('ƒ', 'f')
    .replaceAll('→', '\\to ')
    .replaceAll('≠', '\\neq ')
    .replaceAll('≤', '\\leq ')
    .replaceAll('≥', '\\geq ')
    .replaceAll('∞', '\\infty ')
    .replaceAll('∫', '\\int ')
    .replaceAll('∑', '\\sum ')
    .replaceAll('∏', '\\prod ')
    .replaceAll('√', '\\sqrt')
    .replaceAll('∂', '\\partial ')
    .replaceAll('∇', '\\nabla ')
    .replaceAll('∈', '\\in ')
    .replaceAll('∉', '\\notin ')
    .replaceAll('⊂', '\\subset ')
    .replaceAll('⊃', '\\supset ')
    .replaceAll('∩', '\\cap ')
    .replaceAll('∪', '\\cup ')
    .replaceAll('α', '\\alpha ')
    .replaceAll('β', '\\beta ')
    .replaceAll('γ', '\\gamma ')
    .replaceAll('δ', '\\delta ')
    .replaceAll('θ', '\\theta ')
    .replaceAll('λ', '\\lambda ')
    .replaceAll('μ', '\\mu ')
    .replaceAll('π', '\\pi ')
    .replaceAll('σ', '\\sigma ')
    .replaceAll('τ', '\\tau ')
    .replaceAll('φ', '\\phi ')
    .replaceAll('ω', '\\omega ')
    .replaceAll('×', '\\times ')
    .replaceAll('·', '\\cdot ')
    .replaceAll('≈', '\\approx ')
    .replaceAll('∼', '\\sim ')
}

// ── LaTeX command fixer ────────────────────────────────────────────────────
// Runs on content already inside a math span ($...$).
// Converts plain-text pseudo-math to proper LaTeX commands.

function fixMathCommands(math: string): string {
  let result = math

  // lim(x \to c) → \lim_{x \to c}
  // After applyUnicodeSubstitutions, → becomes \to  (with trailing space)
  // Pattern handles: lim(x \to c), lim(x \to 0), lim(h \to 0+), lim(x \to \infty)
  result = result.replace(
    /\blim\s*\(\s*([^\s,)]+)\s*\\to\s+([^)]+?)\s*\)/g,
    (_, v, c) => `\\lim_{${v.trim()} \\to ${c.trim()}}`,
  )

  // Also handle lim(x → c) where Unicode arrow wasn't converted yet
  result = result.replace(
    /\blim\s*\(\s*([^\s,)→]+)\s*→\s*([^)]+?)\s*\)/g,
    (_, v, c) => `\\lim_{${v.trim()} \\to ${c.trim()}}`,
  )

  // sqrt(x) → \sqrt{x}  (only when not already prefixed with \)
  result = result.replace(/(?<!\\)\bsqrt\s*\(([^)]+)\)/g, (_, inner) => `\\sqrt{${inner.trim()}}`)

  // n_root[...] → \sqrt[n]{...}  (nth root notation AI sometimes uses)
  result = result.replace(/\bn_root\s*\[([^\]]+)\]/g, (_, inner) => `\\sqrt[n]{${inner.trim()}}`)

  return result
}

// ── Normalisation passes ───────────────────────────────────────────────────

/** Convert backtick-wrapped math-like text to $...$ */
function normalizeInlineCodeMath(markdown: string) {
  return markdown.replace(/`([^`\n]+)`/g, (match, value: string) => {
    const trimmed = value.trim()
    if (!isMathLike(trimmed)) return match
    const sub = applyUnicodeSubstitutions(trimmed)
    return `$${fixMathCommands(sub)}$`
  })
}

/**
 * Convert *italic* spans that look unambiguously like math to $...$
 * and fix pseudo-math commands inside them.
 */
function normalizeItalicMath(markdown: string) {
  // Match *...* that are NOT part of **bold** (single asterisk delimiters only)
  return markdown.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, (match, value: string) => {
    const trimmed = value.trim()
    if (!isMathLikeStrict(trimmed)) return match
    const sub = applyUnicodeSubstitutions(trimmed)
    return `$${fixMathCommands(sub)}$`
  })
}

/**
 * Fix content inside already-present $...$ and $$...$$ spans.
 * AI sometimes produces $lim(x → c)...$ with Unicode arrows and plain lim.
 */
function fixExistingMathSpans(markdown: string) {
  // Fix inline $...$
  let result = markdown.replace(/\$([^$\n]+)\$/g, (match, inner) => {
    const sub = applyUnicodeSubstitutions(inner)
    const fixed = fixMathCommands(sub)
    return fixed === inner ? match : `$${fixed}$`
  })
  // Fix display $$...$$
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (match, inner) => {
    const sub = applyUnicodeSubstitutions(inner)
    const fixed = fixMathCommands(sub)
    return fixed === inner ? match : `$$${fixed}$$`
  })
  return result
}

function normalizeAsciiTables(markdown: string) {
  return markdown
    .replace(/\|\s*:?-{3,}:?\s*\|/g, '| --- |')
    .replace(/^\s*\|?(.+\|.+)\|?\s*\n\s*\|?(\s*:?-{3,}:?\s*\|.+)$/gm, (match) => {
      const lines = match.split('\n')
      if (lines.length < 2) return match
      return lines
        .map((line) => {
          const trimmed = line.trim()
          if (!trimmed.includes('|')) return line
          const withStart = trimmed.startsWith('|') ? trimmed : `| ${trimmed}`
          return withStart.endsWith('|') ? withStart : `${withStart} |`
        })
        .join('\n')
    })
}

function removeHorizontalRuleNoise(markdown: string) {
  return markdown.replace(/^\s*(\*\s*){3,}$/gm, '---')
}

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizeLessonMarkdown(markdown: string) {
  return removeHorizontalRuleNoise(
    normalizeAsciiTables(
      fixExistingMathSpans(
        normalizeItalicMath(
          normalizeInlineCodeMath(markdown),
        ),
      ),
    ),
  ).trim()
}
