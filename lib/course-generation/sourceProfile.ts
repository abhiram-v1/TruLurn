import { generateAI, parseAIJson } from '@/lib/ai'
import crypto from 'crypto'
import type { Db } from 'mongodb'

// ── Source teaching profile types ──────────────────────────────────────────────

export type SourceMetadataProfile = {
  subject_domain: string
  educational_level: string
  document_type: string
  scope: {
    covered_topics: string[]
    full_subject: string
    coverage: 'full' | 'partial' | 'narrow'
  }
  emphasized_concepts: string[]
  implied_prerequisites: string[]
  curriculum_terminology: string[]
  exam_signals: string[]
  teaching_progression: string
  depth_expectation: string
  reconstruction: {
    prerequisite_topics: string[]
    dependent_topics: string[]
    recommended_course_scope: string
  }
}

export type SourceStyleProfile = {
  explanation_pattern: string
  example_structure: string
  tone: string
  terminology: string[]
  recurring_examples: string[]
  addressed_misconceptions: string[]
}

export type SourceProfileEnvelope = {
  schema_version: 'source-profile-v2'
  source_fingerprint: string
  metadata: SourceMetadataProfile
  style: SourceStyleProfile | null
  style_status: 'pending' | 'processing' | 'ready' | 'failed'
  style_attempts: number
  metadata_generated_at: string
  style_generated_at: string | null
  style_error: string | null
}

// Legacy type for backward compatibility
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

export function normalizeProfile(raw: any): SourceTeachingProfile | null {
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

function normalizeMetadataProfile(raw: any): SourceMetadataProfile | null {
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
    emphasized_concepts: asStringArray(raw.emphasized_concepts),
    implied_prerequisites: asStringArray(raw.implied_prerequisites),
    curriculum_terminology: asStringArray(raw.curriculum_terminology),
    exam_signals: asStringArray(raw.exam_signals, 8),
    teaching_progression: String(raw.teaching_progression ?? '').trim(),
    depth_expectation: String(raw.depth_expectation ?? '').trim(),
    reconstruction: {
      prerequisite_topics: asStringArray(raw.reconstruction?.prerequisite_topics, 15),
      dependent_topics: asStringArray(raw.reconstruction?.dependent_topics, 15),
      recommended_course_scope: String(raw.reconstruction?.recommended_course_scope ?? '').trim(),
    },
  }
}

function normalizeStyleProfile(raw: any): SourceStyleProfile | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    explanation_pattern: String(raw.explanation_pattern ?? '').trim(),
    example_structure: String(raw.example_structure ?? '').trim(),
    tone: String(raw.tone ?? '').trim(),
    terminology: asStringArray(raw.terminology),
    recurring_examples: asStringArray(raw.recurring_examples, 8),
    addressed_misconceptions: asStringArray(raw.addressed_misconceptions, 8),
  }
}

/**
 * Fast metadata analysis that runs pre-curriculum using structure-only outline.
 */
export async function analyzeSourceMetadata({
  goals,
  compactOutline,
  sourceFingerprint,
}: {
  goals: string
  compactOutline: string
  sourceFingerprint: string
}): Promise<SourceMetadataProfile | null> {
  if (!compactOutline.trim()) return null

  try {
    const text = await generateAI({
      feature: 'source_profile',
      system: `You are TruLurn's source material metadata analyst.
A learner uploaded study material so an AI tutor can teach exactly what that material covers. Your job is to extract metadata from the outline of the material, determine what topics it covers, what concepts it emphasizes, and what prerequisites are implied. Do not write a curriculum. Return only valid JSON. No markdown.`,
      user: `The learner's goal:
${goals}

Uploaded material outline/structure:
---
${compactOutline}
---

Analyze in three layers and return one JSON object:

LAYER 1 — Content understanding:
- subject_domain: the broader subject this material belongs to.
- educational_level: school year / undergrad / grad / professional.
- document_type: "full_course" | "chapter" | "lecture_notes" | "slides" | "assignments" | "reference" | "mixed".
- scope.covered_topics: the topics the material ACTUALLY covers.
- scope.full_subject: the broader subject label.
- scope.coverage: "full" if the material spans the whole subject, "partial" for several units, "narrow" for one unit/chapter.

LAYER 2 — Progression and expectations:
- teaching_progression: descriptive overview of how concepts build on each other across the material.
- depth_expectation: how deeply the student is expected to understand (memorize? derive? apply?).

LAYER 3 — Cues and boundaries:
- curriculum_terminology: terminology, notation, and phrasing to use in naming topics.
- emphasized_concepts: concepts given disproportionate attention, repetition, or marked importance.
- exam_signals: question patterns, mark allocations, "important for exam" cues, solved-problem styles.
- implied_prerequisites: knowledge the material assumes without teaching.
- reconstruction.prerequisite_topics: background topics the material assumes but does not teach. Out of scope.
- reconstruction.dependent_topics: topics the material points toward but does not teach. Out of scope.
- reconstruction.recommended_course_scope: one paragraph describing only the course supported by the uploaded material.

Return exactly:
{
  "subject_domain": "...",
  "educational_level": "...",
  "document_type": "...",
  "scope": { "covered_topics": ["..."], "full_subject": "...", "coverage": "full|partial|narrow" },
  "emphasized_concepts": ["..."],
  "implied_prerequisites": ["..."],
  "curriculum_terminology": ["..."],
  "exam_signals": ["..."],
  "teaching_progression": "...",
  "depth_expectation": "...",
  "reconstruction": { "prerequisite_topics": ["..."], "dependent_topics": ["..."], "recommended_course_scope": "..." }
}`,
      responseMimeType: 'application/json',
    })

    return normalizeMetadataProfile(parseAIJson<any>(text))
  } catch (error) {
    console.warn('[sourceProfile] Metadata analysis failed.', error)
    return null
  }
}

/**
 * Deferred teaching style analysis.
 */
export async function analyzeSourceTeachingStyle({
  goals,
  sourceEvidence,
  metadata,
}: {
  goals: string
  sourceEvidence: string
  metadata: SourceMetadataProfile
}): Promise<SourceStyleProfile | null> {
  if (!sourceEvidence.trim()) return null

  try {
    const text = await generateAI({
      feature: 'source_profile',
      system: `You are TruLurn's source teaching style analyst.
A learner uploaded study material so an AI tutor can teach exactly what that material covers in the way its original author teaches it. Your job is to extract style indicators, explanation patterns, tone, recurring examples, and typical misconceptions warnings. Return only valid JSON. No markdown.`,
      user: `The learner's goal:
${goals}

Metadata of the source:
${JSON.stringify(metadata, null, 2)}

Uploaded material evidence (excerpts or outline):
---
${sampleSource(sourceEvidence)}
---

Analyze and return one JSON object:
- explanation_pattern: how ideas are explained (definition-first? intuition-first? problem-driven?).
- example_structure: how examples are constructed and presented.
- tone: formal/conversational, terse/verbose, rigorous/applied.
- terminology: instructor-specific terms, notations, and phrasings to reuse.
- recurring_examples: examples reused across sections.
- addressed_misconceptions: mistakes/confusions the material explicitly warns about.

Return exactly:
{
  "explanation_pattern": "...",
  "example_structure": "...",
  "tone": "...",
  "terminology": ["..."],
  "recurring_examples": ["..."],
  "addressed_misconceptions": ["..."]
}`,
      responseMimeType: 'application/json',
    })

    return normalizeStyleProfile(parseAIJson<any>(text))
  } catch (error) {
    console.warn('[sourceProfile] Teaching style analysis failed.', error)
    return null
  }
}

/**
 * Legacy monolithic function for backward compatibility.
 */
export async function analyzeSourceProfile({
  goals,
  sourceText,
}: {
  goals: string
  sourceText: string
}): Promise<SourceTeachingProfile | null> {
  const metadata = await analyzeSourceMetadata({ goals, compactOutline: sourceText, sourceFingerprint: 'legacy' })
  if (!metadata) return null
  const style = await analyzeSourceTeachingStyle({ goals, sourceEvidence: sourceText, metadata })
  if (!style) return null
  return {
    ...metadata,
    teaching_style: {
      explanation_pattern: style.explanation_pattern,
      example_structure: style.example_structure,
      progression: metadata.teaching_progression,
      tone: style.tone,
      depth_expectation: metadata.depth_expectation,
    },
    terminology: style.terminology,
    recurring_examples: style.recurring_examples,
    addressed_misconceptions: style.addressed_misconceptions,
  }
}

function section(label: string, items: string[]): string | null {
  return items.length ? `${label}:\n- ${items.join('\n- ')}` : null
}

/** Prompt block for the curriculum builder (source-based learning mode). */
export function formatSourceProfileForCurriculum(profile: SourceProfileEnvelope | SourceTeachingProfile | null | undefined): string {
  if (!profile) return ''

  const isV2 = profile && 'schema_version' in profile && profile.schema_version === 'source-profile-v2'
  const metadata = (isV2 ? (profile as SourceProfileEnvelope).metadata : profile) as any

  return [
    `SOURCE ANALYSIS (what the uploaded material contains and how it teaches):`,
    `Subject domain: ${metadata.subject_domain}`,
    `Educational level: ${metadata.educational_level}`,
    `Document type: ${metadata.document_type}`,
    `Coverage of the broader subject: ${metadata.scope?.coverage} — the course covers ONLY the material below, regardless.`,
    section('Topics the material actually covers (the entire course universe)', metadata.scope?.covered_topics),
    section('Concepts the instructor emphasizes (give these weight and depth)', metadata.emphasized_concepts),
    section('Background the material ASSUMES but never teaches (→ out_of_scope.assumed_prerequisites, NOT topics)', [
      ...(metadata.implied_prerequisites || []),
      ...(metadata.reconstruction?.prerequisite_topics || []).filter((t: string) => !metadata.implied_prerequisites?.includes(t)),
    ]),
    section('Subject topics that would FOLLOW this material but are not in it (→ out_of_scope.mentioned_followups, NOT topics)', metadata.reconstruction?.dependent_topics),
    section('Exam-oriented signals', metadata.exam_signals),
    [
      'Teaching style to honor in topic naming and sequencing:',
      (isV2 ? metadata.teaching_progression : metadata.teaching_style?.progression)
        ? `- Progression: ${isV2 ? metadata.teaching_progression : metadata.teaching_style?.progression}`
        : null,
      (isV2 ? metadata.depth_expectation : metadata.teaching_style?.depth_expectation)
        ? `- Depth expectation: ${isV2 ? metadata.depth_expectation : metadata.teaching_style?.depth_expectation}`
        : null,
    ].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n')
}

/** Compact source-derived teaching signals. The active persona owns the voice. */
export function formatSourceProfileForLessons(profile: SourceProfileEnvelope | SourceTeachingProfile | null | undefined): string {
  if (!profile) return ''

  const isV2 = 'schema_version' in profile && profile.schema_version === 'source-profile-v2'

  if (isV2) {
    const style = profile.style
    const metadata = profile.metadata
    if (!style) {
      return [
        `SOURCE TEACHING SIGNALS (the active TruLurn persona owns the explanation and voice):`,
        metadata.depth_expectation ? `- Depth expectation: ${metadata.depth_expectation}` : null,
        metadata.emphasized_concepts.length
          ? `- Give extra weight to the instructor's emphasized concepts: ${metadata.emphasized_concepts.join('; ')}`
          : null,
        metadata.exam_signals.length
          ? `- The material is exam-oriented; mirror its question/solved-problem patterns: ${metadata.exam_signals.join('; ')}`
          : null,
      ].filter(Boolean).join('\n')
    }

    return [
      `SOURCE TEACHING SIGNALS (preserve academic content and conventions; the active TruLurn persona owns the explanation and voice):`,
      style.explanation_pattern ? `- Preserve this explanation order only when it reflects a meaningful conceptual dependency: ${style.explanation_pattern}` : null,
      style.example_structure ? `- Example structure: ${style.example_structure}` : null,
      metadata.depth_expectation ? `- Depth expectation: ${metadata.depth_expectation}` : null,
      style.terminology.length
        ? `- Preserve the field/source terminology where it applies: ${style.terminology.join('; ')}`
        : null,
      style.recurring_examples.length
        ? `- Prefer the instructor's recurring examples when they fit: ${style.recurring_examples.join('; ')}`
        : null,
      metadata.emphasized_concepts.length
        ? `- Give extra weight to the instructor's emphasized concepts: ${metadata.emphasized_concepts.join('; ')}`
        : null,
      metadata.exam_signals.length
        ? `- The material is exam-oriented; mirror its question/solved-problem patterns: ${metadata.exam_signals.join('; ')}`
        : null,
      style.addressed_misconceptions.length
        ? `- Address the same misconceptions the material warns about: ${style.addressed_misconceptions.join('; ')}`
        : null,
    ].filter(Boolean).join('\n')
  }

  const legacy = profile as SourceTeachingProfile
  return [
    `SOURCE TEACHING SIGNALS (preserve academic content and conventions; the active TruLurn persona owns the explanation and voice):`,
    legacy.teaching_style?.explanation_pattern ? `- Preserve this explanation order only when it reflects a meaningful conceptual dependency: ${legacy.teaching_style.explanation_pattern}` : null,
    legacy.teaching_style?.example_structure ? `- Example structure: ${legacy.teaching_style.example_structure}` : null,
    legacy.teaching_style?.depth_expectation ? `- Depth expectation: ${legacy.teaching_style.depth_expectation}` : null,
    legacy.terminology?.length
      ? `- Preserve the field/source terminology where it applies: ${legacy.terminology.join('; ')}`
      : null,
    legacy.recurring_examples?.length
      ? `- Prefer the instructor's recurring examples when they fit: ${legacy.recurring_examples.join('; ')}`
      : null,
    legacy.emphasized_concepts?.length
      ? `- Give extra weight to the instructor's emphasized concepts: ${legacy.emphasized_concepts.join('; ')}`
      : null,
    legacy.exam_signals?.length
      ? `- The material is exam-oriented; mirror its question/solved-problem patterns: ${legacy.exam_signals.join('; ')}`
      : null,
    legacy.addressed_misconceptions?.length
      ? `- Address the same misconceptions the material warns about: ${legacy.addressed_misconceptions.join('; ')}`
      : null,
  ].filter(Boolean).join('\n')
}

/**
 * Queues and triggers background style analysis.
 */
export async function triggerBackgroundStyleAnalysis({
  db,
  userId,
  generationJobId,
  sourceFingerprint,
  goals,
  sourceText,
  metadata,
}: {
  db: Db
  userId: string
  generationJobId: string
  sourceFingerprint: string
  goals: string
  sourceText: string
  metadata: SourceMetadataProfile
}) {
  const existingJob = await db.collection('sourceStyleJobs').findOne({
    source_fingerprint: sourceFingerprint,
  })

  if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'running')) {
    return
  }

  const jobId = existingJob?._id || crypto.randomUUID()
  if (!existingJob) {
    await db.collection('sourceStyleJobs').insertOne({
      _id: jobId as any,
      user_id: userId,
      generation_job_id: generationJobId,
      course_id: null,
      source_fingerprint: sourceFingerprint,
      status: 'queued',
      attempts: 0,
      max_attempts: 3,
      lease_expires_at: null,
      error: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }

  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000) // 5 min lease
  const claim = await db.collection('sourceStyleJobs').findOneAndUpdate(
    {
      _id: jobId as any,
      status: { $in: ['queued', 'retryable'] },
      $or: [
        { lease_expires_at: null },
        { lease_expires_at: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'running',
        lease_expires_at: leaseExpiresAt,
        updated_at: now,
      },
      $inc: { attempts: 1 }
    },
    { returnDocument: 'after' }
  )

  if (!claim) {
    return
  }

  void (async () => {
    try {
      const style = await analyzeSourceTeachingStyle({
        goals,
        sourceEvidence: sourceText,
        metadata,
      })

      if (!style) {
        throw new Error('Teaching style analysis returned null.')
      }

      await db.collection('sourceStyleJobs').updateOne(
        { _id: jobId as any },
        {
          $set: {
            status: 'completed',
            style,
            completed_at: new Date(),
            lease_expires_at: null,
            updated_at: new Date(),
          }
        }
      )

      await db.collection('generationJobs').updateMany(
        {
          _id: generationJobId as any,
          'input.sourceProfile.source_fingerprint': sourceFingerprint
        },
        {
          $set: {
            'input.sourceProfile.style': style,
            'input.sourceProfile.style_status': 'ready',
            'input.sourceProfile.style_generated_at': new Date().toISOString(),
            updated_at: new Date()
          }
        }
      )
    } catch (err: any) {
      await db.collection('sourceStyleJobs').updateOne(
        { _id: jobId as any },
        {
          $set: {
            status: 'retryable',
            error: err?.message || String(err),
            lease_expires_at: null,
            updated_at: new Date(),
          }
        }
      )
    }
  })()
}
