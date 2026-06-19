import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('markdown renderer treats Remember and TLDR as insight callouts', () => {
  const source = readFileSync(new URL('./MarkdownContent.tsx', import.meta.url), 'utf8')
  assert.match(source, /\^Remember/)
  assert.match(source, /\^TL;\?DR/)
})
