// Test-only module resolver for the `@/` path alias.
//
// The app resolves `@/*` -> `<root>/*` via tsconfig `paths` (honored by Next.js
// and tsc). Node's built-in test runner + `--experimental-strip-types` does NOT
// read tsconfig, so it can only resolve `@/` specifiers that are type-only (those
// are erased at runtime). Value imports like `import { generateAI } from '@/lib/ai'`
// fail to resolve, which is why the agent/doubt/quiz modules were untestable.
//
// This registers a synchronous resolve hook (Node >= 22.15) that maps `@/x` to the
// real file under the project root, with TypeScript-style extension/index
// resolution. Everything else defers to the default resolver. Used only by the
// `test` script via `--import`; it never runs in the app build.

import { registerHooks } from 'node:module'
import { statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

// Several core modules (e.g. lib/db.ts) validate connection env vars at import
// time. Unit tests pass a fake Db directly and never open a real connection, so
// a syntactically-valid dummy URI lets the module graph load without contacting
// any server (the mongodb driver defers connection until the first operation).
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/trulurn-test'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

function isFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function resolveAliasToUrl(specifier) {
  const base = join(ROOT, specifier.slice(2)) // strip the leading '@/'
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.mjs'),
  ]
  for (const candidate of candidates) {
    if (isFile(candidate)) return pathToFileURL(candidate).href
  }
  // Fall back to the .ts guess so the error message names a concrete file.
  return pathToFileURL(`${base}.ts`).href
}

// lib/db.ts opens a real MongoDB connection at import time (eager client.connect()).
// Unit tests inject their own fake Db, so we replace the module with a stub to keep
// the import graph side-effect-free — no socket, no 30s server-selection hang.
const DB_STUB_SOURCE = `const clientPromise = Promise.reject(
  new Error('lib/db is stubbed during unit tests; inject a fake Db instead.'),
)
clientPromise.catch(() => {})
export default clientPromise
export async function getDb() {
  throw new Error('lib/db.getDb() is unavailable during unit tests; inject a fake Db instead.')
}
`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return { url: resolveAliasToUrl(specifier), shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.replace(/\\/g, '/').endsWith('/lib/db.ts')) {
      return { format: 'module', shortCircuit: true, source: DB_STUB_SOURCE }
    }
    return nextLoad(url, context)
  },
})
