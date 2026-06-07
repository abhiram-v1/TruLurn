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
- Use $$...$$ only as standalone display-math fences.
- A display equation MUST be formatted exactly like:
  $$
  \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
  $$
- Never put prose on the same line as $$.
- Never place two display-math fences on the same line.
- Never write patterns like "$$ then $$", "$$ if", "$$ where", "$$ Thus", or "$$ Then".
- Any \\begin{bmatrix}, \\frac, \\mathbb, \\cdot, \\quad, multi-line derivation, or matrix/vector calculation MUST be inside a standalone $$ block.
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
Use inline math as $\\lim_{x \\to c} f(x)$. Use display math only as:
$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$
</content>`,
  }
}
