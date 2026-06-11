import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import * as nextEnv from '@next/env'

let loaded = false

export function ensureSandboxEnvironment() {
  if (loaded && (process.env.OPENAI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)) {
    return
  }

  const cwd = process.cwd()
  const candidates = [
    cwd,
    path.resolve(cwd, '..'),
    path.resolve(cwd, '../..'),
  ]
  const projectRoot = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, '.env.local')),
  )

  if (!projectRoot) {
    throw new Error('Could not locate TruLurn .env.local from the graph sandbox.')
  }

  nextEnv.loadEnvConfig(
    projectRoot,
    process.env.NODE_ENV !== 'production',
    console,
    true,
  )
  loaded = true
}
