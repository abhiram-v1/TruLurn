import type { ActionIntent } from '@/types/agent'

// More-specific intents are listed first — the detection loop stops at the first match.
// custom_quiz must precede quiz_request (both match "quiz" substring).
// generate_page must precede go_deeper/simplify (both could match "another" etc).
const PRIORITY_ORDER: ActionIntent[] = [
  'custom_quiz',
  'generate_page',
  'explain_again',
  'go_deeper',
  'simplify',
  'show_example',
  'go_to_topic',
  'next_topic',
  'prev_topic',
  'quiz_request',
]

const ACTION_SIGNALS: Record<ActionIntent, string[]> = {
  quiz_request: [
    'quiz', 'test me', 'test myself', 'question me',
    'give me a quiz', 'i want a quiz', 'practice questions',
    'ready to be tested', 'assess me', 'am i ready',
  ],
  next_topic: [
    'next topic', 'move on', 'continue', "i'm done", 'im done',
    "i'm ready", 'im ready', 'finished this', 'next section',
    "what's next", 'whats next', 'lets move', 'go to next',
  ],
  prev_topic: [
    'go back', 'previous topic', 'last topic',
    'back to', 'revisit', 'review previous',
  ],
  explain_again: [
    'explain again', "didn't understand", "don't understand", "dont understand",
    'confused', 'lost', 'say that again', 'another way',
    'not clear', 'try again', "still don't get it", "still dont get it",
  ],
  go_deeper: [
    'go deeper', 'more detail', 'elaborate', 'expand on',
    'tell me more', 'in depth', 'deeper explanation',
  ],
  simplify: [
    'simpler', 'simplify', 'too complex', 'easier',
    'plain english', 'dumb it down', 'basic version', 'eli5',
    'for a beginner',
  ],
  show_example: [
    'give me an example', 'show me an example',
    'can you demonstrate', 'illustrate',
    'concrete example', 'real world example',
  ],
  go_to_topic: [
    'take me to', 'navigate to', 'jump to',
  ],
  custom_quiz: [
    'quiz me on', 'test me on',
    'practice questions for', 'questions about',
  ],
  generate_page: [
    'give me a page', 'generate a page', 'create a page',
    'add a page', 'i need a page', 'another page',
    'make a page', 'write a page', 'a page on',
    'new page on', 'a page about',
  ],
}

export function detectActionIntent(message: string): ActionIntent | null {
  const m = message.toLowerCase().trim()
  for (const intent of PRIORITY_ORDER) {
    if (ACTION_SIGNALS[intent].some((signal) => m.includes(signal))) {
      return intent
    }
  }
  return null
}
