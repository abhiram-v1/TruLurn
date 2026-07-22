import assert from 'node:assert/strict'
import test from 'node:test'
import { repairMathFences, normalizeLessonMarkdown } from './lesson-markdown.ts'

// The cascade from production: one `$$` glued to the end of a prose line
// desyncs every later fence — prose renders as red KaTeX errors, formulas
// fall out as raw text, and `=` lines become setext <h1>s.
const CASCADE = `A column vector often represents coefficients stacked for use in a formula, such as $$
\\begin{bmatrix}w_1\\\\w_2\\\\w_3\\end{bmatrix}.
$$

## Transpose

> **Definition:** The **transpose** swaps rows and columns, turning $1 \\times n$ into $n \\times 1$:

$$
\\begin{bmatrix}1 & 2 & 3\\end{bmatrix}^T
=
\\begin{bmatrix}1\\\\2\\\\3\\end{bmatrix}.
$$

For a column vector, it goes the other way:

$$
\\begin{bmatrix}1\\\\2\\\\3\\end{bmatrix}^T
=
\\begin{bmatrix}1 & 2 & 3\\end{bmatrix}.
$$

For a matrix, every entry at position $(i,j)$ moves to $(j,i)$.`

function fenceLines(markdown: string): number {
  return markdown.split('\n').filter((l) => /^\s*\$\$\s*$/.test(l)).length
}

test('repairMathFences fixes the trailing-$$ cascade so fences pair evenly', () => {
  const repaired = repairMathFences(CASCADE)
  // Even number of fence-only lines → blocks pair up.
  assert.equal(fenceLines(repaired) % 2, 0)
  // The glued fence moved off the prose line.
  assert.match(repaired, /such as\n\$\$\n\\begin\{bmatrix\}w_1/)
  // Heading and blockquote are back outside math.
  const lines = repaired.split('\n')
  const headingIdx = lines.findIndex((l) => l === '## Transpose')
  assert.notEqual(headingIdx, -1)
  // Walk fences: the heading must not sit inside an open block.
  let open = false
  for (let i = 0; i < headingIdx; i += 1) {
    if (/^\s*\$\$\s*$/.test(lines[i])) open = !open
  }
  assert.equal(open, false)
})

test('repairMathFences is idempotent and leaves well-formed content unchanged', () => {
  const wellFormed = `Some prose here.

$$
\\frac{a}{b} = c
$$

More prose with inline $x^2$ math.`
  assert.equal(repairMathFences(wellFormed), wellFormed)
  const repaired = repairMathFences(CASCADE)
  assert.equal(repairMathFences(repaired), repaired)
})

test('repairMathFences closes a block whose closing fence is missing', () => {
  const input = `Intro sentence.

$$
\\frac{a}{b}

Next paragraph of ordinary prose follows here.`
  const repaired = repairMathFences(input)
  assert.match(repaired, /\$\$\n\\frac\{a\}\{b\}\n\$\$/)
  assert.match(repaired, /Next paragraph of ordinary prose follows here\./)
  assert.equal(fenceLines(repaired) % 2, 0)
})

test('repairMathFences wraps unfenced TeX above a stray closing fence', () => {
  const input = `Consider the matrix:

\\begin{bmatrix}1 & 2\\end{bmatrix}
$$

And then prose continues.`
  const repaired = repairMathFences(input)
  assert.match(repaired, /\$\$\n\\begin\{bmatrix\}1 & 2\\end\{bmatrix\}\n\$\$/)
  assert.equal(fenceLines(repaired) % 2, 0)
})

test('repairMathFences drops a stray fence that would swallow prose', () => {
  const input = `Some prose.

$$

The next section is entirely ordinary prose without any math at all.`
  const repaired = repairMathFences(input)
  assert.equal(fenceLines(repaired), 0)
  assert.match(repaired, /entirely ordinary prose/)
})

test('repairMathFences leaves $$ inside code fences alone', () => {
  const input = 'Shell example:\n\n```bash\necho $$\n$$\n```\n\nDone.'
  assert.equal(repairMathFences(input), input)
})

test('repairMathFences splits a fully inline unclosed display formula', () => {
  const input = 'such as $$ \\begin{bmatrix}w_1\\\\w_2\\end{bmatrix}.'
  const repaired = repairMathFences(input)
  assert.equal(repaired, 'such as\n$$\n\\begin{bmatrix}w_1\\\\w_2\\end{bmatrix}.\n$$')
})

test('normalizeLessonMarkdown runs fence repair before other passes', () => {
  const out = normalizeLessonMarkdown(CASCADE)
  assert.equal(fenceLines(out) % 2, 0)
  assert.match(out, /## Transpose/)
})
