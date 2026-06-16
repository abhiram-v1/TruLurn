export type LessonOpeningQualityInput = {
  content: string
  pageNumber: number
  pageRole?: string | null
}

function openingExcerpt(content: string) {
  return content
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^>\s?.*$/gm, '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .find(Boolean)
    ?.slice(0, 700) ?? ''
}

export function evaluateLessonOpening({
  content,
  pageNumber,
  pageRole,
}: LessonOpeningQualityInput) {
  const opening = openingExcerpt(content)
  const issues: string[] = []
  if (!opening) return ['The lesson has no substantive opening paragraph.']

  if (
    /\b(the|this|your) (source|document|material|notes?)\b|\baccording to (the|this|your) (source|document|material|notes?)\b/i.test(opening)
  ) {
    issues.push('The opening comments on source material instead of teaching the idea directly.')
  }

  if (
    /^(suppose|imagine|picture this|think about|consider this|have you ever wondered|what if you wanted to)\b/i.test(opening)
  ) {
    issues.push('The opening uses a canned hypothetical hook instead of beginning with substantive insight.')
  }

  const isIntro = pageNumber === 1 && (!pageRole || pageRole === 'introduce')
  if (
    isIntro
    && /\b(spam filter|spam and non spam|cats? (?:versus|vs\.?|and) dogs?|house prices?|movie recommendations?|netflix recommendations?|recogniz(?:e|ing) faces?|self driving cars?)\b/i.test(opening)
  ) {
    issues.push('The opening relies on an overused stock example rather than the most revealing framing for this concept.')
  }

  if (
    /\b(in this (page|lesson)|this (page|lesson) (?:will|covers)|before we (?:begin|dive in)|welcome to)\b/i.test(opening)
  ) {
    issues.push('The opening contains throat-clearing instead of immediately teaching.')
  }

  return issues
}

export function buildOpeningRepairDirective(issues: string[]) {
  return `OPENING QUALITY REPAIR:
The previous draft failed these checks:
${issues.map((issue) => `- ${issue}`).join('\n')}

Rewrite the page with a genuinely useful opening. Start with the concept's central tension, mechanism, consequence, boundary, or decision. A direct explanatory statement is better than a manufactured hook. Do not mention sources or documents, and do not reuse stock textbook examples. Preserve the required factual coverage and citations.`
}
