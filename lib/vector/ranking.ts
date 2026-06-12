export type RetrievalMethod = 'dense' | 'lexical'

export type RankedCandidate<T> = {
  id: string
  item: T
  text: string
  groupKey?: string | null
  denseRank?: number
  denseScore?: number | null
  lexicalRank?: number
  lexicalScore?: number | null
  fusedScore: number
  rerankScore: number
  methods: RetrievalMethod[]
}

type CandidateInput<T> = {
  id: string
  item: T
  text: string
  groupKey?: string | null
  score?: number | null
}

export function denseRank<T>({
  dense,
  limit,
  minimumScore = 0,
  maxPerGroup = 2,
}: {
  dense: CandidateInput<T>[]
  limit: number
  minimumScore?: number
  maxPerGroup?: number
}): RankedCandidate<T>[] {
  const selected: RankedCandidate<T>[] = []
  const groupCounts = new Map<string, number>()

  for (let index = 0; index < dense.length && selected.length < limit; index += 1) {
    const candidate = dense[index]
    const score = Number(candidate.score ?? 0)
    if (score < minimumScore) continue
    if (
      candidate.groupKey
      && (groupCounts.get(candidate.groupKey) ?? 0) >= maxPerGroup
    ) continue

    selected.push({
      ...candidate,
      denseRank: index + 1,
      denseScore: candidate.score ?? null,
      fusedScore: 0,
      rerankScore: score,
      methods: ['dense'],
    })
    if (candidate.groupKey) {
      groupCounts.set(
        candidate.groupKey,
        (groupCounts.get(candidate.groupKey) ?? 0) + 1,
      )
    }
  }

  return selected
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what',
  'when', 'where', 'which', 'why', 'with',
])

export function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_+#.-]+/gu)
    ?.map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []
}

function tokenSet(value: string) {
  return new Set(tokenize(value))
}

function overlapRatio(queryTokens: Set<string>, candidateTokens: Set<string>) {
  if (!queryTokens.size) return 0
  let matches = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matches += 1
  }
  return matches / queryTokens.size
}

function jaccard(left: string, right: string) {
  const a = tokenSet(left)
  const b = tokenSet(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  return intersection / (a.size + b.size - intersection)
}

function exactTermBonus(query: string, candidateText: string) {
  const technicalTerms = query.match(/\b(?:[A-Z]{2,}|[A-Za-z_]+\d+|[\w.]+::[\w.]+|[\w.]+\(\)|\d+(?:\.\d+)+)\b/g) ?? []
  if (!technicalTerms.length) return 0
  const haystack = candidateText.toLowerCase()
  const hits = technicalTerms.filter((term) => haystack.includes(term.toLowerCase())).length
  return hits / technicalTerms.length
}

export function hybridRank<T>({
  query,
  dense,
  lexical,
  limit,
  minimumScore = 0.16,
  diversityLambda = 0.78,
  maxPerGroup = 2,
}: {
  query: string
  dense: CandidateInput<T>[]
  lexical: CandidateInput<T>[]
  limit: number
  minimumScore?: number
  diversityLambda?: number
  maxPerGroup?: number
}): RankedCandidate<T>[] {
  if (limit <= 0) return []

  const byId = new Map<string, RankedCandidate<T>>()
  const rrfConstant = 60

  dense.forEach((candidate, index) => {
    byId.set(candidate.id, {
      ...candidate,
      denseRank: index + 1,
      denseScore: candidate.score ?? null,
      fusedScore: 1 / (rrfConstant + index + 1),
      rerankScore: 0,
      methods: ['dense'],
    })
  })

  lexical.forEach((candidate, index) => {
    const existing = byId.get(candidate.id)
    if (existing) {
      existing.lexicalRank = index + 1
      existing.lexicalScore = candidate.score ?? null
      existing.fusedScore += 1 / (rrfConstant + index + 1)
      existing.methods.push('lexical')
      return
    }
    byId.set(candidate.id, {
      ...candidate,
      lexicalRank: index + 1,
      lexicalScore: candidate.score ?? null,
      fusedScore: 1 / (rrfConstant + index + 1),
      rerankScore: 0,
      methods: ['lexical'],
    })
  })

  const queryTokens = tokenSet(query)
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim()
  const maxFused = Math.max(...[...byId.values()].map((candidate) => candidate.fusedScore), 1)

  const candidates = [...byId.values()].map((candidate) => {
    const normalizedText = candidate.text.toLowerCase().replace(/\s+/g, ' ').trim()
    const coverage = overlapRatio(queryTokens, tokenSet(candidate.text))
    const phrase = normalizedQuery.length >= 8 && normalizedText.includes(normalizedQuery) ? 1 : 0
    const exact = exactTermBonus(query, candidate.text)
    const methodAgreement = candidate.methods.length === 2 ? 1 : 0
    const denseQuality = Math.max(0, Math.min(1, Number(candidate.denseScore ?? 0)))
    const rankQuality = candidate.fusedScore / maxFused

    candidate.rerankScore =
      rankQuality * 0.38 +
      coverage * 0.27 +
      phrase * 0.12 +
      exact * 0.1 +
      methodAgreement * 0.08 +
      denseQuality * 0.05
    return candidate
  })
    .filter((candidate) => candidate.rerankScore >= minimumScore)
    .sort((left, right) => right.rerankScore - left.rerankScore)

  const selected: RankedCandidate<T>[] = []
  const groupCounts = new Map<string, number>()
  const remaining = [...candidates]

  while (selected.length < limit && remaining.length) {
    let bestIndex = -1
    let bestScore = Number.NEGATIVE_INFINITY

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const groupKey = candidate.groupKey?.trim()
      if (groupKey && (groupCounts.get(groupKey) ?? 0) >= maxPerGroup) continue
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => jaccard(candidate.text, item.text)))
        : 0
      const mmrScore =
        diversityLambda * candidate.rerankScore -
        (1 - diversityLambda) * redundancy
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIndex = index
      }
    }

    if (bestIndex < 0) break
    const [picked] = remaining.splice(bestIndex, 1)
    selected.push(picked)
    if (picked.groupKey) {
      groupCounts.set(picked.groupKey, (groupCounts.get(picked.groupKey) ?? 0) + 1)
    }
  }

  return selected
}
