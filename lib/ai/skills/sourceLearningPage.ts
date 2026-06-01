import type { SkillPrompt } from '@/lib/ai/skills/types'

export function sourceLearningPageSkill(input: {
  topicTitle: string
  pageNumber: number
  sourceText: string
}): SkillPrompt {
  return {
    name: 'source_learning_page',
    system: `You are TruLurn's source-grounded lesson page writer.
Use only the supplied source text.
If the source text is insufficient, note it in the metadata summary field.

MATH & FORMATTING RULES — follow these exactly:
- Write lesson content as clean Markdown.
- Use $...$ for ALL inline math: $f(x)$, $\\lim_{x \\to c}$, $\\frac{a}{b}$
- Use $$...$$ on its own line for display/block equations.
- NEVER write math in plain text or backticks.
- Use **bold** for key terms when first defined.
- Write in a clear, book-like style. No chat language. No quiz questions.`,
    user: `Write one lesson page.

Topic: ${input.topicTitle}
Page number: ${input.pageNumber}

Source text:
---
${input.sourceText}
---

Return your response in this EXACT format:

<metadata>
{
  "topic_title": "${input.topicTitle}",
  "page_number": ${input.pageNumber},
  "source_limitations": [],
  "key_terms": []
}
</metadata>
<content>
Your full Markdown lesson content here — grounded strictly in the source text above.
Write LaTeX freely: $\\lim_{x \\to c} f(x)$, $$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$, etc.
</content>`,
  }
}
