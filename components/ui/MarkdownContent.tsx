'use client'

import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import {
  IconBook2,
  IconFlask,
  IconSparkles,
} from '@tabler/icons-react'

SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('r', r)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('yml', yaml)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('xml', markup)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('c', c)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)

// ── Custom Prism theme (TruLurn palette) ─────────────────────────────────────

const trulurnTheme: { [key: string]: React.CSSProperties } = {
  'code[class*="language-"]': {
    color: '#050517',
    background: 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    overflowWrap: 'normal',
    lineHeight: '1.65',
    tabSize: 4,
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: '#050517',
    background: 'none',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    overflowWrap: 'normal',
    lineHeight: '1.65',
    tabSize: 4,
    hyphens: 'none',
    padding: '0',
    margin: '0',
  },
  comment:    { color: '#928e82', fontStyle: 'italic' },
  prolog:     { color: '#928e82' },
  doctype:    { color: '#928e82' },
  cdata:      { color: '#928e82' },
  punctuation: { color: '#50505a' },
  property:   { color: '#050517' },
  tag:        { color: '#c0552a' },
  boolean:    { color: '#c0552a' },
  number:     { color: '#6b4c92' },
  constant:   { color: '#6b4c92' },
  symbol:     { color: '#6b4c92' },
  deleted:    { color: '#b91c1c' },
  selector:   { color: '#3a5f8a' },
  'attr-name':  { color: '#c0552a' },
  string:     { color: '#7a5c3f' },
  char:       { color: '#7a5c3f' },
  builtin:    { color: '#3a5f8a' },
  inserted:   { color: '#3b6d11' },
  operator:   { color: '#050517' },
  entity:     { color: '#050517' },
  url:        { color: '#050517' },
  variable:   { color: '#050517' },
  atrule:     { color: '#c0552a' },
  'attr-value': { color: '#7a5c3f' },
  function:   { color: '#3a5f8a' },
  'class-name': { color: '#3a5f8a' },
  keyword:    { color: '#c0552a', fontWeight: 'bold' },
  regex:      { color: '#7a5c3f' },
  important:  { color: '#c0552a', fontWeight: 'bold' },
  namespace:  { opacity: 0.7 },
}

// ── CodeBlock component ───────────────────────────────────────────────────────

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [value])

  const displayLang = language || 'text'

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{displayLang}</span>
        <button className="md-code-copy" onClick={handleCopy} type="button">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="md-code-body">
        <SyntaxHighlighter
          language={displayLang}
          style={trulurnTheme}
          PreTag="div"
          customStyle={{ background: 'transparent', margin: 0, padding: 0 }}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

// ── Inline callout cards ──────────────────────────────────────────────────────
// Renders > **Definition:** / > **Example:** / > **Key insight:** blockquotes
// as styled cards with icons. Applied consistently everywhere md-content is used.

type CalloutType = 'definition' | 'example' | 'insight'

const CALLOUT_ICON: Record<CalloutType, React.ReactNode> = {
  definition: <IconBook2 size={15} stroke={1.8} aria-hidden="true" />,
  example:    <IconFlask size={15} stroke={1.8} aria-hidden="true" />,
  insight:    <IconSparkles size={15} stroke={1.8} aria-hidden="true" />,
}

function CalloutCard({ type, children }: { type: CalloutType; children: React.ReactNode }) {
  return (
    <div className={`md-callout md-callout-${type}`}>
      <span className="md-callout-icon">{CALLOUT_ICON[type]}</span>
      <div className="md-callout-body">{children}</div>
    </div>
  )
}

// Peek into the HAST node to detect whether the first strong in the first
// paragraph matches a TruLurn callout label pattern.
function detectCalloutType(node: any): CalloutType | null {
  // HAST nodes: type='element', tagName='p'|'strong'|etc; type='text' for text
  const firstEl = node?.children?.find(
    (c: any) => c.type === 'element' && c.tagName === 'p',
  )
  const firstStrong = firstEl?.children?.find(
    (c: any) => c.type === 'element' && c.tagName === 'strong',
  )
  if (!firstStrong) return null

  const label = (firstStrong.children ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.value as string)
    .join('')
    .trim()

  if (/^Definition/i.test(label)) return 'definition'
  if (/^Example/i.test(label)) return 'example'
  if (/^Key insight/i.test(label) || /^Key idea/i.test(label)) return 'insight'
  return null
}

// ── Custom renderers ──────────────────────────────────────────────────────────

const components: Components = {
  // Strip the <pre> wrapper — CodeBlock provides its own container
  pre({ children }) {
    return <>{children}</>
  },
  // Inline code → pill; block code (language-* or multiline) → CodeBlock with highlighting
  code({ className, children }) {
    const lang = /language-(\w+)/.exec(className || '')?.[1] || ''
    const value = String(children)
    const isBlock = Boolean(className?.startsWith('language-')) || value.includes('\n')
    if (isBlock) {
      return <CodeBlock language={lang} value={value.replace(/\n$/, '')} />
    }
    return <code className="md-inline-code">{children}</code>
  },
  p({ children }) {
    return <p className="md-p">{children}</p>
  },
  strong({ children }) {
    return <strong className="md-strong">{children}</strong>
  },
  em({ children }) {
    return <em className="md-em">{children}</em>
  },
  ol({ children }) {
    return <ol className="md-ol">{children}</ol>
  },
  ul({ children }) {
    return <ul className="md-ul">{children}</ul>
  },
  li({ children }) {
    return <li className="md-li">{children}</li>
  },
  h1({ children }) {
    return <h1 className="md-h1">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="md-h2">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="md-h3">{children}</h3>
  },
  blockquote({ children, node }) {
    const callout = detectCalloutType(node as any)
    if (callout) return <CalloutCard type={callout}>{children}</CalloutCard>
    return <blockquote className="md-blockquote">{children}</blockquote>
  },
  hr() {
    return <hr className="md-hr" />
  },
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MarkdownContentProps {
  children: string
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MarkdownContent({ children, className = '' }: MarkdownContentProps) {
  return (
    <div className={`md-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
