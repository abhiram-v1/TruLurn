// ── Display-math fence repair ──────────────────────────────────────────────
// AI output sometimes glues a `$$` fence to prose ("...such as $$") or drops a
// closing fence. One misplaced `$$` desyncs every later fence: remark-math then
// captures PROSE as display math (red KaTeX errors, space-swallowed sentences)
// while the actual formulas fall out as raw text — and a stray `=` line even
// turns the formula above it into a setext <h1>. The repair has two passes:
//   1. move fences that share a line with other content onto their own lines
//   2. re-pair fence lines, closing blocks whose closer is missing and
//      dropping stray fences that would otherwise swallow prose
// Both passes are idempotent, so running the repair on already-clean content
// is a no-op.

const FENCE_ONLY_RE = /^\s*\$\$\s*$/
const CODE_FENCE_RE = /^\s*(```|~~~)/

/** A line that plausibly belongs inside a display-math block. */
function looksLikeMathContentLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^#{1,6}\s/.test(t)) return false
  if (t.startsWith('>')) return false
  if (/^([-*+]|\d+\.)\s/.test(t)) return false
  if (t.startsWith('|')) return false
  if (t.includes('\\')) return true
  // No TeX commands: only accept short symbol-ish lines (e.g. "=", "x + 1"),
  // not prose — prose is what a desynced fence would wrongly swallow.
  const words = t.match(/[A-Za-z]{2,}/g) ?? []
  return words.length <= 3
}

/** Pass 1: put every lone `$$` fence on its own line. */
function splitMixedFenceLines(markdown: string): string {
  const out: string[] = []
  let inCode = false
  for (const line of markdown.split('\n')) {
    if (CODE_FENCE_RE.test(line)) {
      inCode = !inCode
      out.push(line)
      continue
    }
    if (inCode || FENCE_ONLY_RE.test(line)) {
      out.push(line)
      continue
    }
    // Even counts are self-contained inline math ($$x$$) — leave those alone.
    const count = (line.match(/\$\$/g) ?? []).length
    if (count !== 1) {
      out.push(line)
      continue
    }
    const idx = line.indexOf('$$')
    const before = line.slice(0, idx).trimEnd()
    const after = line.slice(idx + 2).trim()
    if (before) out.push(before)
    out.push('$$')
    if (after) out.push(after)
  }
  return out.join('\n')
}

/** Pass 2: re-pair fence-only lines so no block captures prose. */
function repairFencePairing(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inCode = false
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (CODE_FENCE_RE.test(line)) {
      inCode = !inCode
      out.push(line)
      i += 1
      continue
    }
    if (inCode || !FENCE_ONLY_RE.test(line)) {
      out.push(line)
      i += 1
      continue
    }

    // Fence-only line: scan forward over math content (tolerating blanks) to
    // find either the closing fence or the first prose/structure boundary.
    let k = i + 1
    let lastMathIdx = i
    let sawMath = false
    while (k < lines.length) {
      if (FENCE_ONLY_RE.test(lines[k])) break
      const t = lines[k].trim()
      if (!t) {
        k += 1
        continue
      }
      if (!looksLikeMathContentLine(lines[k])) break
      sawMath = true
      lastMathIdx = k
      k += 1
    }

    if (k < lines.length && FENCE_ONLY_RE.test(lines[k])) {
      if (sawMath) {
        // Proper block: emit fence, content, fence.
        for (let m = i; m <= k; m += 1) out.push(lines[m])
      }
      // else: empty $$ ... $$ block — drop both fences.
      i = k + 1
      continue
    }

    if (sawMath) {
      // Opener with math content but the closing fence is missing before
      // prose/structure/EOF: close right after the last math line.
      for (let m = i; m <= lastMathIdx; m += 1) out.push(lines[m])
      out.push('$$')
      i = lastMathIdx + 1
      continue
    }

    // Stray fence with no math after it. If the lines right above are
    // unfenced TeX (contain a backslash command), this is a closer whose
    // opener went missing — wrap backward. Otherwise drop the fence.
    let back = out.length
    while (
      back > 0
      && out[back - 1].trim()
      && !FENCE_ONLY_RE.test(out[back - 1])
      && looksLikeMathContentLine(out[back - 1])
    ) back -= 1
    const wrapped = out.slice(back)
    if (wrapped.length && wrapped.some((l) => l.includes('\\'))) {
      out.splice(back, 0, '$$')
      out.push('$$')
    }
    i += 1
  }

  return out.join('\n')
}

/**
 * Repair malformed `$$` display-math fences so a single AI formatting slip
 * cannot cascade into broken rendering for the rest of a page.
 */
export function repairMathFences(markdown: string): string {
  if (!markdown.includes('$$')) return markdown
  return repairFencePairing(splitMixedFenceLines(markdown))
}

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
          normalizeInlineCodeMath(repairMathFences(markdown)),
        ),
      ),
    ),
  ).trim()
}
