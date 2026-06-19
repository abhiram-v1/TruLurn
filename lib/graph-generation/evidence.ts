import { flattenCurriculumForGraph } from './curriculum.ts'
import type { GraphSourceEvidencePacket, GraphSourceExcerpt } from './types.ts'

const MAX_TOTAL_EVIDENCE_CHARS = 40_000
const MAX_EXCERPT_CHARS = 900

type ParsedSource = {
  number: number
  title: string
  body: string
  headings: string[]
  sections: Array<{ headingPath: string[]; text: string }>
}

function compact(value: string, max: number) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  if (max <= 3) return clean.slice(0, max)
  return `${clean.slice(0, max - 3).trim()}...`
}

function parseSources(sourceText: string): ParsedSource[] {
  const starts = Array.from(sourceText.matchAll(/^Source\s+(\d+):\s*(.+)$/gmi))
  if (!starts.length && sourceText.trim()) {
    starts.push(Object.assign(['Source 1: Uploaded source', '1', 'Uploaded source'], { index: 0 }) as any)
  }

  return starts.map((match, index) => {
    const start = Number(match.index ?? 0)
    const bodyStart = sourceText.indexOf('\n', start)
    const end = index + 1 < starts.length ? Number(starts[index + 1].index) : sourceText.length
    const body = sourceText.slice(bodyStart >= 0 ? bodyStart + 1 : start, end)
      .replace(/\n---\s*$/m, '')
      .trim()
    const sections: ParsedSource['sections'] = []
    let headingPath: string[] = []
    let buffer: string[] = []

    const flush = () => {
      const text = buffer.join('\n').trim()
      if (text) sections.push({ headingPath: [...headingPath], text })
      buffer = []
    }

    for (const line of body.split(/\r?\n/)) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        flush()
        const level = heading[1].length
        headingPath = [...headingPath.slice(0, level - 1), heading[2].trim()]
      } else {
        buffer.push(line)
      }
    }
    flush()

    return {
      number: Number(match[1] ?? index + 1),
      title: String(match[2] ?? `Source ${index + 1}`).trim(),
      body,
      headings: Array.from(new Set(sections.flatMap((section) => section.headingPath))).slice(0, 80),
      sections: sections.length ? sections : [{ headingPath: [], text: body }],
    }
  })
}

function terms(value: string) {
  return new Set(
    value.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  )
}

function overlapScore(topicText: string, section: { headingPath: string[]; text: string }) {
  const topicTerms = terms(topicText)
  const candidateTerms = terms(`${section.headingPath.join(' ')} ${section.text.slice(0, 1600)}`)
  let score = 0
  for (const term of topicTerms) if (candidateTerms.has(term)) score += 1
  return score
}

export function buildGraphSourceEvidencePackets(
  curriculum: unknown,
  sourceText = '',
): GraphSourceEvidencePacket[] {
  if (!sourceText.trim()) return []
  const course = flattenCurriculumForGraph(curriculum)
  const sources = parseSources(sourceText)
  let remaining = MAX_TOTAL_EVIDENCE_CHARS

  return sources.map((source) => {
    const topicEvidence: GraphSourceEvidencePacket['topic_evidence'] = []
    for (const topic of course.topics) {
      const anchorMatch = topic.source_anchor?.match(/\bSource\s+(\d+)\b/i)
      if (anchorMatch && Number(anchorMatch[1]) !== source.number) continue

      const query = `${topic.title} ${topic.description} ${topic.source_anchor ?? ''}`
      const selected = source.sections
        .map((section) => ({ section, score: overlapScore(query, section) }))
        .filter((candidate) => candidate.score > 0 || Boolean(anchorMatch))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)

      const excerpts: GraphSourceExcerpt[] = []
      for (const candidate of selected) {
        if (remaining <= 0) break
        const text = compact(candidate.section.text, Math.min(MAX_EXCERPT_CHARS, remaining))
        if (!text) continue
        remaining -= text.length
        excerpts.push({ heading_path: candidate.section.headingPath, text })
      }

      if (excerpts.length || anchorMatch) {
        topicEvidence.push({
          topic_id: topic.id,
          source_anchor: topic.source_anchor ?? `Source ${source.number}`,
          excerpts,
        })
      }
    }

    return {
      source_id: `source-${source.number}`,
      source_number: source.number,
      title: source.title,
      headings: source.headings,
      topic_evidence: topicEvidence,
    }
  })
}
