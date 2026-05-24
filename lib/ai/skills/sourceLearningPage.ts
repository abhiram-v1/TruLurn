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
If the source text is insufficient, say so in JSON.
Return only valid JSON.`,
    user: `Write one lesson page.

Topic: ${input.topicTitle}
Page number: ${input.pageNumber}

Source text:
---
${input.sourceText}
---

Return:
{
  "topic_title": "${input.topicTitle}",
  "page_number": ${input.pageNumber},
  "content_markdown": "stored lesson page markdown",
  "source_limitations": [],
  "key_terms": []
}

Rules:
- Page should be readable like a book.
- No chat language.
- No quiz question.
- Do not go outside the source.`,
  }
}
