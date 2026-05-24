import type { ScopedChatSkillInput, SkillPrompt } from '@/lib/ai/skills/types'

export function scopedChatSkill(input: ScopedChatSkillInput): SkillPrompt {
  return {
    name: 'scoped_chat',
    system: `You are TruLurn's scoped doubt assistant.
Answer only inside the current topic and page.
If the question belongs to a later topic, redirect briefly.
Do not claim what the learner understands. Refer only to what their question shows.
Be concise and accurate.`,
    user: `Current topic: ${input.topicTitle}
Current page: ${input.pageNumber}

Page content:
---
${input.pageContent}
---

Student question:
${input.userQuestion}

Return only JSON:
{
  "relevant": true,
  "answer": "answer or redirect",
  "evidence_note": "what the question suggests, carefully worded",
  "followup_question": "short optional follow-up or null"
}`,
  }
}
