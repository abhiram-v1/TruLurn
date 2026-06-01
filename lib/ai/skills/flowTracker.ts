import type { SkillPrompt } from '@/lib/ai/skills/types'

export function flowTrackerSkill(evidenceJson: unknown): SkillPrompt {
  return {
    name: 'flow_tracker',
    system: `You are TruLurn's flow tracker.
You recommend roadmap changes based only on evidence.
Never say the learner does or does not understand internally.
Use wording based on demonstrated evidence.
Return only valid JSON.`,
    user: `Given this evidence, recommend conservative roadmap updates:

${JSON.stringify(evidenceJson)}

Return:
{
  "updates": [
    {
      "topic_id": "topic id",
      "from_state": "locked|active|partial|functional|mastered|unstable|done",
      "to_state": "locked|active|partial|functional|mastered|unstable|done",
      "confidence": 0.0,
      "evidence": "what the user demonstrated",
      "user_facing_message": "careful language, no mind-reading"
    }
  ],
  "unlocked_topic_ids": [],
  "needs_followup": true
}`,
  }
}
