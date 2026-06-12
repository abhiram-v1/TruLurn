import { generateAI, parseAIJson } from '@/lib/ai'

// ── Source teaching profile ───────────────────────────────────────────────────
//
// Source-based learning mode treats uploads as the course's hard content
// boundary. Before the curriculum is built, this module reads the material:
// it learns HOW it teaches (style, terminology, recurring examples, emphasis,
// exam orientation), maps which concepts it actually covers, and identifies
// the boundary — background it assumes and follow-ups it only mentions. The
// curriculum builder organizes ONLY the covered concepts (prequel → current →
// sequel) and surfaces the boundary lists as out-of-scope context, never as
// generated lessons.

export type SourceTeachingProfile = {
  subject_domain: string
  educational_level: string
  document_type: string // full_course | chapter | lecture_notes | slides | assignments | reference | mixed
  scope: {
    covered_topics: string[]
    full_subject: string
    coverage: 'full' | 'partial' | 'narrow'
  }
  teaching_style: {
    explanation_pattern: string
    example_structure: string
    progression: string
    tone: string
    depth_expectation: string
  }
  terminology: string[]
  emphasized_concepts: string[]
  recurring_examples: string[]
  exam_signals: string[]
  implied_prerequisites: string[]
  addressed_misconceptions: string[]
  reconstruction: {
    prerequisite_topics: string[]
    dependent_topics: string[]
    recommended_course_scope: string
  }
}

// Analysis input budget. Style and emphasis show up everywhere in a document,
// so head + tail sampling preserves the signal even for long uploads.
const HEAD_CHARS = 34000
const TAIL_CHARS = 10000

function sampleSource(sourceText: string): string {
  if (sourceText.length <= HEAD_CHARS + TAIL_CHARS) return sourceText
  return [
    sourceText.slice(0, HEAD_CHARS),
    '\n\n[... middle of the uploaded material omitted for analysis ...]\n\n',
    sourceText.slice(-TAIL_CHARS),
  ].join('')
}

function asStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, max)
}

function normalizeProfile(raw: any): SourceTeachingProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const subject = String(raw.subject_domain ?? '').trim()
  if (!subject) return null
  const coverage = ['full', 'partial', 'narrow'].includes(String(raw.scope?.coverage))
    ? (String(raw.scope.coverage) as 'full' | 'partial' | 'narrow')
    : 'partial'
  return {
    subject_domain: subject,
    educational_level: String(raw.educational_level ?? '').trim() || 'unspecified',
    document_type: String(raw.document_type ?? '').trim() || 'mixed',
    scope: {
      covered_topics: asStringArray(raw.scope?.covered_topics, 20),
      full_subject: String(raw.scope?.full_subject ?? '').trim() || subject,
      coverage,
    },
    teaching_style: {
      explanation_pattern: String(raw.teaching_style?.explanation_pattern ?? '').trim(),
      example_structure: String(raw.teaching_style?.example_structure ?? '').trim(),
      progression: String(raw.teaching_style?.progression ?? '').trim(),
      tone: String(raw.teaching_style?.tone ?? '').trim(),
      depth_expectation: String(raw.teaching_style?.depth_expectation ?? '').trim(),
    },
    terminology: asStringArray(raw.terminology),
    emphasized_concepts: asStringArray(raw.emphasized_concepts),
    recurring_examples: asStringArray(raw.recurring_examples, 8),
    exam_signals: asStringArray(raw.exam_signals, 8),
    implied_prerequisites: asStringArray(raw.implied_prerequisites),
    addressed_misconceptions: asStringArray(raw.addressed_misconceptions, 8),
    reconstruction: {
      prerequisite_topics: asStringArray(raw.reconstruction?.prerequisite_topics, 15),
      dependent_topics: asStringArray(raw.reconstruction?.dependent_topics, 15),
      recommended_course_scope: String(raw.reconstruction?.recommended_course_scope ?? '').trim(),
    },
  }
}

/**
 * Read the uploaded material like a tutor reads school notes. One model call
 * covering: content understanding, teaching-pattern extraction, hidden-signal
 * detection, and curriculum reconstruction. Returns null on any failure —
 * course generation degrades gracefully to source text alone.
 */
export async function analyzeSourceProfile({
  goals,
  sourceText,
}: {
  goals: string
  sourceText: string
}): Promise<SourceTeachingProfile | null> {
  if (!sourceText.trim()) return null

  try {
    const text = await generateAI({
      feature: 'source_profile',
      system: `You are TruLurn's source material analyst.
A learner uploaded study material so an AI tutor can teach them THE WHOLE SUBJECT the way the material's original instructor or author teaches it. The learner may be a school or university student, a working professional, a hobbyist, an educator, or a researcher — do not assume which. You do not summarize the content. You profile how it teaches and reconstruct the curriculum it belongs to.
Return only valid JSON. No markdown. No prose outside JSON.`,
      user: `The learner's goal:
${goals}

Uploaded material (may be sampled):
---
${sampleSource(sourceText)}
---

Analyze in four layers and return one JSON object:

LAYER 1 — Content understanding:
- subject_domain: the broader subject this material belongs to (e.g. "Database Management Systems", not "Transactions").
- educational_level: school year / undergrad / grad / professional, as evidenced by depth and phrasing.
- document_type: "full_course" | "chapter" | "lecture_notes" | "slides" | "assignments" | "reference" | "mixed".
- scope.covered_topics: the topics the material ACTUALLY covers.
- scope.full_subject: the complete subject a serious course on this domain would cover.
- scope.coverage: "full" if the material spans the whole subject, "partial" for several units, "narrow" for one unit/chapter.

LAYER 2 — Teaching pattern extraction:
- teaching_style.explanation_pattern: how ideas are explained (definition-first? intuition-first? problem-driven?).
- teaching_style.example_structure: how examples are constructed and presented.
- teaching_style.progression: how concepts build on each other across the material.
- teaching_style.tone: formal/conversational, terse/verbose, rigorous/applied.
- teaching_style.depth_expectation: how deeply the student is expected to understand (memorize? derive? apply?).

LAYER 3 — Hidden signal detection:
- terminology: instructor/institution-specific terms, notations, and phrasings to reuse verbatim.
- emphasized_concepts: concepts given disproportionate attention, repetition, or marked importance.
- recurring_examples: examples reused across sections (reuse these in lessons).
- exam_signals: question patterns, mark allocations, "important for exam" cues, solved-problem styles.
- implied_prerequisites: knowledge the material assumes without teaching.
- addressed_misconceptions: mistakes/confusions the material explicitly warns about.

LAYER 4 — Curriculum reconstruction:
- reconstruction.prerequisite_topics: subject topics that should be taught BEFORE the covered material.
- reconstruction.dependent_topics: subject topics that naturally FOLLOW the covered material.
- reconstruction.recommended_course_scope: one paragraph describing the complete course this material implies, honoring the learner's goal.

Return exactly:
{
  "subject_domain": "...",
  "educational_level": "...",
  "document_type": "...",
  "scope": { "covered_topics": ["..."], "full_subject": "...", "coverage": "full|partial|narrow" },
  "teaching_style": { "explanation_pattern": "...", "example_structure": "...", "progression": "...", "tone": "...", "depth_expectation": "..." },
  "terminology": ["..."],
  "emphasized_concepts": ["..."],
  "recurring_examples": ["..."],
  "exam_signals": ["..."],
  "implied_prerequisites": ["..."],
  "addressed_misconceptions": ["..."],
  "reconstruction": { "prerequisite_topics": ["..."], "dependent_topics": ["..."], "recommended_course_scope": "..." }
}`,
      responseMimeType: 'application/json',
    })

    return normalizeProfile(parseAIJson<any>(text))
  } catch (error) {
    console.warn('[sourceProfile] Analysis failed — continuing without a teaching profile.', error)
    return null
  }
}

function section(label: string, items: string[]): string | null {
  return items.length ? `${label}:\n- ${items.join('\n- ')}` : null
}

/** Prompt block for the curriculum builder (source-based learning mode).
 *  The analysis is used to organize WHAT THE SOURCES CONTAIN — the
 *  reconstruction lists mark the out-of-scope boundary, not topics to add. */
export function formatSourceProfileForCurriculum(profile: SourceTeachingProfile | null | undefined): string {
  if (!profile) return ''
  return [
    `SOURCE ANALYSIS (what the uploaded material contains and how it teaches):`,
    `Subject domain: ${profile.subject_domain}`,
    `Educational level: ${profile.educational_level}`,
    `Document type: ${profile.document_type}`,
    `Coverage of the broader subject: ${profile.scope.coverage} — the course covers ONLY the material below, regardless.`,
    section('Topics the material actually covers (the entire course universe)', profile.scope.covered_topics),
    section('Concepts the instructor emphasizes (give these weight and depth)', profile.emphasized_concepts),
    section('Background the material ASSUMES but never teaches (→ out_of_scope.assumed_prerequisites, NOT topics)', [
      ...profile.implied_prerequisites,
      ...profile.reconstruction.prerequisite_topics.filter((t) => !profile.implied_prerequisites.includes(t)),
    ]),
    section('Subject topics that would FOLLOW this material but are not in it (→ out_of_scope.mentioned_followups, NOT topics)', profile.reconstruction.dependent_topics),
    section('Exam-oriented signals', profile.exam_signals),
    [
      'Teaching style to honor in topic naming and sequencing:',
      profile.teaching_style.explanation_pattern ? `- Explanation: ${profile.teaching_style.explanation_pattern}` : null,
      profile.teaching_style.progression ? `- Progression: ${profile.teaching_style.progression}` : null,
      profile.teaching_style.depth_expectation ? `- Depth expectation: ${profile.teaching_style.depth_expectation}` : null,
    ].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n')
}

/** Compact prompt block for the lesson writer — instructor voice, not content. */
export function formatSourceProfileForLessons(profile: SourceTeachingProfile | null | undefined): string {
  if (!profile) return ''
  return [
    `INSTRUCTOR STYLE PROFILE (extracted from the student's uploaded materials — write as if taught by the same instructor):`,
    profile.teaching_style.explanation_pattern ? `- Explanation pattern: ${profile.teaching_style.explanation_pattern}` : null,
    profile.teaching_style.example_structure ? `- Example structure: ${profile.teaching_style.example_structure}` : null,
    profile.teaching_style.tone ? `- Tone: ${profile.teaching_style.tone}` : null,
    profile.teaching_style.depth_expectation ? `- Depth expectation: ${profile.teaching_style.depth_expectation}` : null,
    profile.terminology.length
      ? `- Use the instructor's terminology verbatim where it applies: ${profile.terminology.join('; ')}`
      : null,
    profile.recurring_examples.length
      ? `- Prefer the instructor's recurring examples when they fit: ${profile.recurring_examples.join('; ')}`
      : null,
    profile.emphasized_concepts.length
      ? `- Give extra weight to the instructor's emphasized concepts: ${profile.emphasized_concepts.join('; ')}`
      : null,
    profile.exam_signals.length
      ? `- The material is exam-oriented; mirror its question/solved-problem patterns: ${profile.exam_signals.join('; ')}`
      : null,
    profile.addressed_misconceptions.length
      ? `- Address the same misconceptions the material warns about: ${profile.addressed_misconceptions.join('; ')}`
      : null,
  ].filter(Boolean).join('\n')
}
