import { generateAI } from '@/lib/ai'
import { shouldRetrieveAppKnowledge } from '@/lib/agent/appKnowledge'
import type { ActionIntent } from '@/types/agent'
import type { DoubtQuestionType } from '@/lib/doubts/classifyQuestion'

// ── Return type ───────────────────────────────────────────────────────────────

export type ClassifyResult =
  | { kind: 'action'; intent: ActionIntent }
  | { kind: 'doubt'; questionType: DoubtQuestionType }

// ── Combined classifier ───────────────────────────────────────────────────────
// Single AI call that replaces two sequential calls (classifyIntent +
// classifyQuestion). Returns either an action to execute or the doubt
// question type needed to pick the right retrieval strategy.

const SYSTEM = `You are a one-label classifier for a student learning assistant.

Output exactly one label — nothing else, no punctuation, no explanation.

DOUBT labels (student wants a response in the chat):
  current_page      — question about content on the current lesson page; asks about "this", specific terms, examples, or anything visible in the lesson right now
  general_knowledge — question about a broad concept not tied to this course's content or sequence
  course_specific   — references earlier course material, compares to previous topics, or needs cross-topic context

ACTION labels (student is issuing an unambiguous command at the lesson):
  EXPLAIN_AGAIN   — lesson page should be rewritten with a completely different approach
  GO_DEEPER       — lesson page should be regenerated with more depth and detail
  SIMPLIFY        — lesson page should be simplified
  NEXT_TOPIC      — navigate to the next topic
  PREV_TOPIC      — go back to the previous topic
  QUIZ_REQUEST    — open the quiz for the current topic
  CUSTOM_QUIZ     — quiz on a specific named topic
  GO_TO_TOPIC     — navigate to a specific named topic
  GENERATE_PAGE   — generate a new custom page

  SKIP_CURRENT    - student says they already understand this and wants to move on or skip remaining ungenerated pages
  CHANGE_PERSONA  - student explicitly asks to switch the teaching persona used for ALL future lessons
                    Examples: "switch to Investigator", "use Immersive Builder from now on"
                    Key signal: refers to "lessons", "pages" (plural), "the course", "from now on", "going forward"
                    NOT this action: "can you make this more practical?" or "show more examples here" (those are current_page)

RULES:
- Default to current_page when ambiguous. Only choose an ACTION for clear, unambiguous commands.
- "I'm confused about X" → current_page (question, not a page-regen command)
- "explain again" (bare) → EXPLAIN_AGAIN
- "can you go deeper on recursion?" → current_page (asking about a concept, not commanding the page)
- "go deeper" (bare) → GO_DEEPER
- "give me an example of X" → current_page
- "give me a page with examples" → GENERATE_PAGE
- "what did we cover earlier about X?" → course_specific`

const REINFORCED_SYSTEM = `${SYSTEM}

Extra command examples:
- "I already understand this, move on" -> SKIP_CURRENT
- "skip the rest of this topic" -> SKIP_CURRENT
- "do not generate more pages here" -> SKIP_CURRENT
- "I know the basics, continue" -> SKIP_CURRENT
`

const DOUBT_LABELS = new Set<string>(['current_page', 'general_knowledge', 'course_specific'])

const INTENT_MAP: Record<string, ActionIntent> = {
  EXPLAIN_AGAIN:       'explain_again',
  GO_DEEPER:           'go_deeper',
  SIMPLIFY:            'simplify',
  NEXT_TOPIC:          'next_topic',
  PREV_TOPIC:          'prev_topic',
  QUIZ_REQUEST:        'quiz_request',
  CUSTOM_QUIZ:         'custom_quiz',
  GO_TO_TOPIC:         'go_to_topic',
  GENERATE_PAGE:       'generate_page',
  SKIP_CURRENT:        'skip_current',
  CHANGE_PERSONA:      'change_teaching_persona',
}

function normalizeMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bareCommand(text: string, commands: string[]) {
  return commands.some((command) => {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    return new RegExp(`^(please\\s+)?(can\\s+you\\s+)?(could\\s+you\\s+)?(just\\s+)?${escaped}(\\s+please)?$`).test(text)
  })
}

function deterministicActionIntent(message: string): ActionIntent | null {
  const text = normalizeMessage(message)
  if (!text) return null

  // High-confidence skip/prune intent. This must be explicit because it mutates
  // sequence state; vague confidence statements still fall through to chat.
  const saysUnderstood = /\b(i|we)\s+(already\s+)?(understand|know|get|got|grasp)\s+(this|it|the\s+basics|basics)\b/.test(text)
  const saysMoveOn = /\b(move\s+on|go\s+next|next\s+topic|continue|skip|trim|prune)\b/.test(text)
  const saysSkipRemaining = /\b(skip|trim|prune)\b.*\b(rest|remaining|ungenerated|pages|this\s+topic|topic)\b/.test(text)
  const saysNoMoreNeeded = /\b(no\s+need|dont\s+need|do\s+not\s+need)\b.*\b(more|remaining|rest|this\s+topic|pages)\b/.test(text)
  if ((saysUnderstood && saysMoveOn) || saysSkipRemaining || saysNoMoreNeeded) {
    return 'skip_current'
  }

  if (bareCommand(text, [
    'next',
    'next topic',
    'move on',
    'continue',
    'go next',
    'go to next topic',
    'lets move on',
    'whats next',
    'what next',
  ])) {
    return 'next_topic'
  }

  if (bareCommand(text, [
    'back',
    'go back',
    'previous',
    'previous topic',
    'prev topic',
    'last topic',
    'go to previous topic',
  ])) {
    return 'prev_topic'
  }

  if (bareCommand(text, [
    'quiz',
    'start quiz',
    'open quiz',
    'take quiz',
    'quiz me',
    'test me',
    'assess me',
  ])) {
    return 'quiz_request'
  }

  if (bareCommand(text, ['explain again', 'try again', 'rewrite this page', 'regenerate this page'])) {
    return 'explain_again'
  }

  if (bareCommand(text, ['go deeper', 'make this deeper', 'deeper version'])) {
    return 'go_deeper'
  }

  if (bareCommand(text, ['simplify', 'make this simpler', 'simpler version'])) {
    return 'simplify'
  }

  if (bareCommand(text, ['show example', 'example version', 'regenerate with examples'])) {
    return 'show_example'
  }

  if (/\b(generate|create|make)\b.*\b(new|another|custom)\b.*\b(page|lesson)\b/.test(text)) {
    return 'generate_page'
  }

  if (/\b(go|jump|navigate|open)\b.*\b(topic|lesson|section|traccia)\b/.test(text)) {
    return 'go_to_topic'
  }

  if (/\b(quiz|test)\b.*\b(on|about|for)\b.+/.test(text)) {
    return 'custom_quiz'
  }

  if (
    /\b(switch|change|use|activate)\b.*\b(investigator|immersive builder|teaching persona|persona)\b/.test(text)
  ) {
    return 'change_teaching_persona'
  }

  return null
}

export function classifyIntentDeterministically(message: string): ClassifyResult | null {
  const deterministic = deterministicActionIntent(message)
  if (deterministic) return { kind: 'action', intent: deterministic }

  if (shouldRetrieveAppKnowledge(message)) {
    return { kind: 'doubt', questionType: 'current_page' }
  }

  const normalized = normalizeMessage(message)
  if (/\b(earlier|previously|previous topic|we covered|you said|remind me|course page|global page)\b/.test(normalized)) {
    return { kind: 'doubt', questionType: 'course_specific' }
  }
  if (/\b(this|here|the page|above|selected passage|this example|this diagram)\b/.test(normalized)) {
    return { kind: 'doubt', questionType: 'current_page' }
  }

  return null
}

export async function classifyIntent(
  message: string,
  pageFocus: string,
  recentAssistantMessage?: string,
): Promise<ClassifyResult> {
  const deterministic = classifyIntentDeterministically(message)
  if (deterministic) return deterministic

  try {
    const lines: string[] = []
    if (pageFocus) lines.push(`Lesson page: ${pageFocus}`)
    if (recentAssistantMessage) lines.push(`Last agent reply: ${recentAssistantMessage.slice(0, 160)}`)
    lines.push(`Student: "${message}"`)
    lines.push('Label:')

    const raw = await generateAI({
      feature: 'agent_intent',
      system: REINFORCED_SYSTEM,
      user: lines.join('\n'),
      purpose: 'agent',
      responseMimeType: 'text/plain',
    })

    const label = raw.trim().replace(/[^a-zA-Z_]/g, '')

    if (DOUBT_LABELS.has(label)) {
      return { kind: 'doubt', questionType: label as DoubtQuestionType }
    }

    const intent = INTENT_MAP[label.toUpperCase()]
    if (intent) return { kind: 'action', intent }
  } catch {
    // fall through to safe default
  }

  return { kind: 'doubt', questionType: 'current_page' }
}
