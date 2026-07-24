'use client'

import {
  IconChecks,
  IconMathFunction,
} from '@tabler/icons-react'
import { useState } from 'react'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type { ConceptKind, LessonSection, LessonSectionType, TopicDepth } from '@/types'
import type { TransformAction } from '@/components/learn/LessonSelectionToolbar'

export type SectionOverride = {
  original: string
  modified: string
  action: TransformAction
}

const OVERRIDE_LABEL: Record<TransformAction, string> = {
  simplify: 'Simplified',
  deeper:   'Expanded',
  example:  'Example added',
}

// ── Section renderer dispatch ────────────────────────────────────────────────

export function LessonSections({
  sections,
  topicDepth,
  conceptKind,
  sectionOverrides,
  onRestoreSection,
}: {
  sections: LessonSection[]
  topicDepth?: TopicDepth
  conceptKind?: ConceptKind
  sectionOverrides?: Map<number, SectionOverride>
  onRestoreSection?: (idx: number) => void
}) {
  const ORDER: LessonSectionType[] = [
    'prerequisites',
    'core',
    'key_ideas',
    'misconceptions',
    'examples',
    'checkpoints',
  ]

  // Sort while keeping track of original indices (needed for data-section-index and overrides)
  const indexed = filterRenderedSections(
    sections.map((section, originalIdx) => ({ section, originalIdx })),
    topicDepth,
    conceptKind,
  )
  indexed.sort((a, b) => ORDER.indexOf(a.section.type) - ORDER.indexOf(b.section.type))

  return (
    <div className="lesson-sections">
      {indexed.map(({ section, originalIdx }) => {
        const override = sectionOverrides?.get(originalIdx)
        const effective: LessonSection = override
          ? { ...section, content: override.modified }
          : section
        return (
          <SectionBlock
            key={originalIdx}
            section={effective}
            sectionIndex={originalIdx}
            override={override}
            onRestore={override ? () => onRestoreSection?.(originalIdx) : undefined}
          />
        )
      })}
    </div>
  )
}

function optionalBudget(topicDepth?: TopicDepth, conceptKind?: ConceptKind) {
  const depth = topicDepth ?? 'medium'
  const kind = conceptKind ?? 'mechanism'
  if (kind === 'definition') return 0
  if (depth === 'shallow') return kind === 'pitfall' ? 1 : 0
  if (depth === 'medium') return 1
  return 2
}

function sectionPriority(section: LessonSection, topicDepth?: TopicDepth, conceptKind?: ConceptKind) {
  const kind = conceptKind ?? 'mechanism'
  const depth = topicDepth ?? 'medium'
  const wordCount = section.content.trim().split(/\s+/).filter(Boolean).length

  if (section.type === 'misconceptions') return kind === 'pitfall' ? 100 : 70
  if (section.type === 'checkpoints') return kind === 'pitfall' ? 92 : ['math', 'procedure'].includes(kind) ? 82 : 58
  if (section.type === 'examples') return ['math', 'procedure'].includes(kind) ? 88 : depth === 'deep' && wordCount > 100 ? 76 : 55
  if (section.type === 'key_ideas') return ['comparison', 'procedure'].includes(kind) ? 76 : 50
  return 0
}

function optionalContentEarnsRender(section: LessonSection, topicDepth?: TopicDepth, conceptKind?: ConceptKind) {
  const depth = topicDepth ?? 'medium'
  const kind = conceptKind ?? 'mechanism'
  const content = section.content
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  if (section.type === 'key_ideas') {
    const bulletCount = (content.match(/(^|\n)\s*[-*+]\s+/g) ?? []).length
    return bulletCount >= 3 && depth !== 'shallow' && !['definition', 'mechanism'].includes(kind)
  }

  if (section.type === 'misconceptions') {
    return /mistake|wrong|confus|misconception|pitfall|assume/i.test(content)
      && (kind === 'pitfall' || depth === 'deep')
  }

  if (section.type === 'examples') {
    return wordCount >= 70
      && depth !== 'shallow'
      && ['math', 'procedure', 'comparison', 'pitfall', 'mechanism'].includes(kind)
  }

  if (section.type === 'checkpoints') {
    const questionCount = (content.match(/(^|\n)\s*\d+\.\s+/g) ?? []).length
    return questionCount >= 2
      && ['math', 'procedure', 'pitfall', 'comparison'].includes(kind)
      && (depth === 'deep' || kind === 'pitfall')
  }

  return true
}

function filterRenderedSections(
  indexed: Array<{ section: LessonSection; originalIdx: number }>,
  topicDepth?: TopicDepth,
  conceptKind?: ConceptKind,
) {
  const always = indexed.filter(({ section }) => section.type === 'core' || section.type === 'prerequisites')
  const optional = indexed
    .filter(({ section }) => !['core', 'prerequisites'].includes(section.type))
    .filter(({ section }) => optionalContentEarnsRender(section, topicDepth, conceptKind))
    .map((item) => ({ ...item, priority: sectionPriority(item.section, topicDepth, conceptKind) }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, optionalBudget(topicDepth, conceptKind))
    .map(({ priority, ...item }) => item)

  return [...always, ...optional]
}

// ── Section wrapper — carries data-section-index and optional override bar ──

function SectionBlock({
  section,
  sectionIndex,
  override,
  onRestore,
}: {
  section: LessonSection
  sectionIndex: number
  override?: SectionOverride
  onRestore?: () => void
}) {
  return (
    <div
      data-section-index={sectionIndex}
      className={override ? 'ls-section-wrapper ls-section-overridden' : 'ls-section-wrapper'}
    >
      {renderSectionContent(section)}
      {override && onRestore && (
        <div className="ls-override-bar">
          <span className="ls-override-badge">{OVERRIDE_LABEL[override.action]}</span>
          <button className="ls-override-restore" type="button" onClick={onRestore}>
            Restore original
          </button>
        </div>
      )}
    </div>
  )
}

function renderSectionContent(section: LessonSection) {
  switch (section.type) {
    case 'prerequisites':   return <PrerequisitesBlock section={section} />
    case 'core':            return <CoreBlock section={section} />
    case 'key_ideas':       return <LegacyCalloutBlock section={section} label="Lock this in" />
    case 'misconceptions':  return <LegacyCalloutBlock section={section} label="Lock this in" />
    case 'examples':        return <LegacyCalloutBlock section={section} label="Example" />
    case 'checkpoints':     return <CheckpointsBlock section={section} />
    default:                return <CoreBlock section={section} />
  }
}

// ── Individual section blocks ────────────────────────────────────────────────

function PrerequisitesBlock({ section }: { section: LessonSection }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ls-block ls-prerequisites">
      <button
        className="ls-prereq-toggle"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ls-section-icon">
          <IconMathFunction aria-hidden="true" size={14} stroke={1.8} />
        </span>
        <span className="ls-prereq-label">Builds on</span>
        <span className="ls-prereq-chevron">{open ? '▲' : '▼'}</span>
      </button>
      <div className="ls-prereq-body" hidden={!open}>
        <MarkdownContent>{section.content}</MarkdownContent>
      </div>
    </div>
  )
}

function CoreBlock({ section }: { section: LessonSection }) {
  return (
    <div className="ls-block ls-core">
      <MarkdownContent>{section.content}</MarkdownContent>
    </div>
  )
}

function legacyCalloutMarkdown(label: 'Example' | 'Lock this in', content: string) {
  const quotedContent = content
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `> **${label}:**\n>\n${quotedContent}`
}

function LegacyCalloutBlock({
  section,
  label,
}: {
  section: LessonSection
  label: 'Example' | 'Lock this in'
}) {
  return (
    <div className="ls-block ls-core ls-legacy-supplement">
      <MarkdownContent>{legacyCalloutMarkdown(label, section.content)}</MarkdownContent>
    </div>
  )
}

function CheckpointsBlock({ section }: { section: LessonSection }) {
  const questions = parseCheckpoints(section.content)
  return (
    <div className="ls-block ls-checkpoints">
      <div className="ls-section-header">
        <span className="ls-section-icon">
          <IconChecks aria-hidden="true" size={16} stroke={1.8} />
        </span>
        <span className="ls-section-label">Check your understanding</span>
      </div>
      <div className="ls-checkpoint-list">
        {questions.length > 0
          ? questions.map((q, i) => <CheckpointItem key={i} question={q.question} hint={q.hint} index={i + 1} />)
          : <MarkdownContent>{section.content}</MarkdownContent>
        }
      </div>
    </div>
  )
}

function CheckpointItem({ question, hint, index }: { question: string; hint: string | null; index: number }) {
  const [hintOpen, setHintOpen] = useState(false)
  return (
    <div className="ls-checkpoint-item">
      <div className="ls-checkpoint-q">
        <span className="ls-checkpoint-num">{index}.</span>
        <MarkdownContent>{question}</MarkdownContent>
      </div>
      {hint && (
        <div className="ls-checkpoint-hint-row">
          <div className="ls-checkpoint-hint" hidden={!hintOpen}>
            <MarkdownContent>{hint}</MarkdownContent>
          </div>
          {!hintOpen ? (
            <button className="ls-hint-btn" type="button" onClick={() => setHintOpen(true)}>
              Show hint
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ── Checkpoint parser ─────────────────────────────────────────────────────────

function parseCheckpoints(md: string): Array<{ question: string; hint: string | null }> {
  const withoutPreamble = md.replace(/^\*\*Think through this\*\*[^\n]*\n+/i, '').trim()
  const chunks = withoutPreamble.split(/\n(?=\d+\.\s)/).filter(Boolean)
  if (chunks.length === 0) return []

  return chunks.map((chunk) => {
    const lines = chunk.split('\n')
    const questionLines: string[] = []
    const hintLines: string[] = []
    let inHint = false

    for (const line of lines) {
      if (/^\s*>\s*\*Hint:/.test(line) || /^\s*>\s*\*hint:/i.test(line) || (inHint && /^\s*>/.test(line))) {
        inHint = true
        hintLines.push(line.replace(/^\s*>\s*/, '').replace(/^\*Hint:\s*/i, '').replace(/\*$/, '').trim())
      } else {
        inHint = false
        questionLines.push(line.replace(/^\d+\.\s*/, ''))
      }
    }

    return {
      question: questionLines.join('\n').trim(),
      hint: hintLines.length > 0 ? hintLines.join(' ').trim() : null,
    }
  })
}
