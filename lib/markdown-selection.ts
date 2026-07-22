export type MarkdownSelectionAnchor = {
  text: string
  before?: string
  after?: string
}

export type MarkdownSelectionMatch = {
  start: number
  end: number
  markdown: string
}

type ProjectedCharacter = {
  value: string
  start: number
  end: number
}

type Projection = {
  text: string
  characters: ProjectedCharacter[]
}

const ENTITY_VALUES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeEntity(entity: string): string | null {
  const body = entity.slice(1, -1)
  if (body.startsWith('#x') || body.startsWith('#X')) {
    const value = Number.parseInt(body.slice(2), 16)
    return Number.isFinite(value) ? String.fromCodePoint(value) : null
  }
  if (body.startsWith('#')) {
    const value = Number.parseInt(body.slice(1), 10)
    return Number.isFinite(value) ? String.fromCodePoint(value) : null
  }
  return ENTITY_VALUES[body] ?? null
}

function findClosingParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1
      continue
    }
    if (source[i] === '(') depth += 1
    if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function linePrefixLength(line: string): number {
  let consumed = 0
  const quote = line.match(/^ {0,3}(?:>\s*)+/)
  if (quote) consumed = quote[0].length

  const rest = line.slice(consumed)
  const heading = rest.match(/^#{1,6}\s+/)
  if (heading) return consumed + heading[0].length

  const list = rest.match(/^(?:[-+*]|\d+[.)])\s+/)
  if (list) {
    consumed += list[0].length
    const task = line.slice(consumed).match(/^\[[ xX]\]\s+/)
    if (task) consumed += task[0].length
  }
  return consumed
}

function isInvisibleRule(line: string): boolean {
  const trimmed = line.trim()
  if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) return true
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)
}

function isSingleEmphasisDelimiter(source: string, index: number, marker: '*' | '_'): boolean {
  const before = source[index - 1] ?? ' '
  const after = source[index + 1] ?? ' '
  const opens = /[\s\p{P}]/u.test(before) && !/\s/u.test(after)
  const closes = !/\s/u.test(before) && /[\s\p{P}]/u.test(after)
  if (!opens && !closes) return false
  return source.indexOf(marker, index + 1) !== -1
}

/**
 * Build a readable-text projection of Markdown while retaining the source range
 * for every visible character. This mirrors the important parts of what the
 * browser exposes through Selection.toString(): formatting delimiters disappear,
 * while their text remains selectable.
 */
export function projectMarkdownText(source: string): Projection {
  const raw: ProjectedCharacter[] = []
  const delimiterClosures = new Map<number, number>()
  const linkClosures = new Map<number, number>()
  let fence: { marker: string; length: number } | null = null
  let lineStart = true

  const push = (value: string, start: number, end = start + 1) => {
    for (const character of value) raw.push({ value: character, start, end })
  }

  for (let i = 0; i < source.length;) {
    if (lineStart) {
      const lineEnd = source.indexOf('\n', i)
      const end = lineEnd === -1 ? source.length : lineEnd
      const line = source.slice(i, end)
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (fenceMatch) {
        const marker = fenceMatch[1][0]
        if (!fence) fence = { marker, length: fenceMatch[1].length }
        else if (marker === fence.marker && fenceMatch[1].length >= fence.length) fence = null
        i = end
        continue
      }

      if (!fence) {
        if (isInvisibleRule(line)) {
          i = end
          continue
        }
        i += linePrefixLength(line)
      }
      lineStart = false
      if (i >= source.length) break
    }

    const closureLength = delimiterClosures.get(i)
    if (closureLength) {
      delimiterClosures.delete(i)
      i += closureLength
      continue
    }

    const linkEnd = linkClosures.get(i)
    if (linkEnd !== undefined) {
      linkClosures.delete(i)
      i = linkEnd
      continue
    }

    const character = source[i]
    if (character === '\n') {
      push('\n', i)
      i += 1
      lineStart = true
      continue
    }

    if (!fence && character === '\\' && i + 1 < source.length) {
      push(source[i + 1], i + 1)
      i += 2
      continue
    }

    if (!fence && character === '<') {
      const tag = source.slice(i).match(/^<\/?[A-Za-z][^>]*>/)
      if (tag) {
        i += tag[0].length
        continue
      }
    }

    if (!fence && character === '&') {
      const entity = source.slice(i).match(/^&(?:#\d+|#x[\da-f]+|[a-z]+);/i)?.[0]
      const decoded = entity ? decodeEntity(entity) : null
      if (entity && decoded !== null) {
        push(decoded, i, i + entity.length)
        i += entity.length
        continue
      }
    }

    if (!fence && (source.startsWith('![', i) || character === '[')) {
      const bracket = source.startsWith('![', i) ? i + 1 : i
      const close = source.indexOf(']', bracket + 1)
      if (close !== -1 && source[close + 1] === '(') {
        const targetEnd = findClosingParen(source, close + 1)
        if (targetEnd !== -1) {
          linkClosures.set(close, targetEnd + 1)
          i = bracket + 1
          continue
        }
      }
    }

    if (!fence && character === '`') {
      const run = source.slice(i).match(/^`+/)?.[0] ?? '`'
      const close = source.indexOf(run, i + run.length)
      if (close !== -1) {
        delimiterClosures.set(close, run.length)
        i += run.length
        continue
      }
    }

    if (!fence) {
      const paired = ['**', '__', '~~'] as const
      const marker = paired.find((candidate) => source.startsWith(candidate, i))
      if (marker) {
        const close = source.indexOf(marker, i + marker.length)
        if (close !== -1) {
          delimiterClosures.set(close, marker.length)
          i += marker.length
          continue
        }
      }

      if ((character === '*' || character === '_') && isSingleEmphasisDelimiter(source, i, character)) {
        const close = source.indexOf(character, i + 1)
        delimiterClosures.set(close, 1)
        i += 1
        continue
      }

      // GFM table separators are structural, not rendered text.
      if (character === '|') {
        i += 1
        continue
      }
    }

    push(character, i)
    i += 1
  }

  const characters: ProjectedCharacter[] = []
  for (let i = 0; i < raw.length;) {
    const current = raw[i]
    if (/\s/u.test(current.value)) {
      const start = current.start
      let end = current.end
      while (i < raw.length && /\s/u.test(raw[i].value)) {
        end = raw[i].end
        i += 1
      }
      if (characters.length > 0) characters.push({ value: ' ', start, end })
      continue
    }
    characters.push(current)
    i += 1
  }
  if (characters.at(-1)?.value === ' ') characters.pop()

  return { text: characters.map(({ value }) => value).join(''), characters }
}

export function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function sharedSuffixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length)
  let count = 0
  while (count < max && left[left.length - count - 1] === right[right.length - count - 1]) count += 1
  return count
}

function sharedPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length)
  let count = 0
  while (count < max && left[count] === right[count]) count += 1
  return count
}

function expandFormattingBoundaries(source: string, start: number, end: number) {
  let expandedStart = start
  let expandedEnd = end
  for (const marker of ['`', '**', '__', '~~', '*', '_']) {
    let changed = true
    while (changed) {
      changed = false
      const inside = source.slice(expandedStart, expandedEnd)
      const markerCount = inside.split(marker).length - 1
      if (markerCount % 2 === 1 && source.slice(expandedEnd).startsWith(marker)) {
        expandedEnd += marker.length
        changed = true
      }
      if (markerCount % 2 === 1 && source.slice(0, expandedStart).endsWith(marker)) {
        expandedStart -= marker.length
        changed = true
      }
      if (source.slice(0, expandedStart).endsWith(marker) && source.slice(expandedEnd).startsWith(marker)) {
        expandedStart -= marker.length
        expandedEnd += marker.length
        changed = true
      }
    }
  }

  const linkStart = source[expandedStart - 1] === '['
    ? expandedStart - 1
    : source.slice(Math.max(0, expandedStart - 2), expandedStart) === '!['
      ? expandedStart - 2
      : -1
  if (linkStart >= 0 && source[expandedEnd] === ']' && source[expandedEnd + 1] === '(') {
    const linkEnd = findClosingParen(source, expandedEnd + 1)
    if (linkEnd !== -1) return { start: linkStart, end: linkEnd + 1 }
  }

  return { start: expandedStart, end: expandedEnd }
}

export function resolveMarkdownSelection(
  source: string,
  anchor: MarkdownSelectionAnchor,
): MarkdownSelectionMatch | null {
  const selected = normalizeSelectionText(anchor.text)
  if (!selected) return null

  const projection = projectMarkdownText(source)
  const candidates: number[] = []
  let from = 0
  while (from <= projection.text.length - selected.length) {
    const index = projection.text.indexOf(selected, from)
    if (index === -1) break
    candidates.push(index)
    from = index + 1
  }
  if (candidates.length === 0) return null

  let chosen = candidates[0]
  if (candidates.length > 1) {
    const before = normalizeSelectionText(anchor.before ?? '').slice(-240)
    const after = normalizeSelectionText(anchor.after ?? '').slice(0, 240)
    const scored = candidates.map((index) => ({
      index,
      score: sharedSuffixLength(projection.text.slice(0, index).trimEnd(), before)
        + sharedPrefixLength(projection.text.slice(index + selected.length).trimStart(), after),
    })).sort((a, b) => b.score - a.score)

    if (scored[0].score === 0 || scored[0].score === scored[1].score) return null
    chosen = scored[0].index
  }

  const first = projection.characters[chosen]
  const last = projection.characters[chosen + selected.length - 1]
  if (!first || !last) return null
  const expanded = expandFormattingBoundaries(source, first.start, last.end)
  return {
    ...expanded,
    markdown: source.slice(expanded.start, expanded.end),
  }
}

export function replaceMarkdownSelection(
  source: string,
  anchor: MarkdownSelectionAnchor,
  replacement: string,
): { value: string; match: MarkdownSelectionMatch } | null {
  const match = resolveMarkdownSelection(source, anchor)
  if (!match) return null
  return {
    value: `${source.slice(0, match.start)}${replacement.trim()}${source.slice(match.end)}`,
    match,
  }
}

/** Expand a short rendered-text selection to the sentence that contains it. */
export function expandMarkdownSelectionToSentence(
  source: string,
  anchor: MarkdownSelectionAnchor,
): MarkdownSelectionAnchor | null {
  const match = resolveMarkdownSelection(source, anchor)
  if (!match) return null

  const paragraphStartMarker = source.lastIndexOf('\n\n', match.start)
  const paragraphStart = paragraphStartMarker === -1 ? 0 : paragraphStartMarker + 2
  const paragraphEndMarker = source.indexOf('\n\n', match.end)
  const paragraphEnd = paragraphEndMarker === -1 ? source.length : paragraphEndMarker

  let sentenceStart = paragraphStart
  const before = source.slice(paragraphStart, match.start)
  const boundaryPattern = /[.!?](?:["')\]]*)\s+/gu
  let boundary: RegExpExecArray | null
  while ((boundary = boundaryPattern.exec(before))) sentenceStart = paragraphStart + boundary.index + boundary[0].length

  let sentenceEnd = paragraphEnd
  const after = source.slice(match.end, paragraphEnd)
  const endBoundary = after.match(/[.!?](?:["')\]]*)(?=\s|$)/u)
  if (endBoundary?.index !== undefined) sentenceEnd = match.end + endBoundary.index + endBoundary[0].length

  const sentenceText = projectMarkdownText(source.slice(sentenceStart, sentenceEnd)).text
  if (!sentenceText) return null
  return {
    text: sentenceText,
    before: projectMarkdownText(source.slice(Math.max(0, sentenceStart - 600), sentenceStart)).text.slice(-240),
    after: projectMarkdownText(source.slice(sentenceEnd, Math.min(source.length, sentenceEnd + 600))).text.slice(0, 240),
  }
}
