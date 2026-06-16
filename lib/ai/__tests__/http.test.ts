import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { aiFetch } from '../http.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

// A fetch stub that never resolves on its own — it only settles when the signal
// it was handed aborts. This is exactly the "hung upstream" failure mode the
// timeout was built to defend against.
function hangingFetch() {
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      // Mirror real fetch: an already-aborted signal rejects synchronously.
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => {
        reject(signal.reason ?? new Error('aborted'))
      }, { once: true })
    })) as typeof fetch
}

test('aiFetch rejects with a timeout error when the upstream hangs', async () => {
  hangingFetch()
  await assert.rejects(
    aiFetch('https://example.test', { method: 'POST' }, { timeoutMs: 30 }),
    /timed out after 30ms/,
  )
})

test('aiFetch propagates caller cancellation distinctly from a timeout', async () => {
  hangingFetch()
  const controller = new AbortController()
  const promise = aiFetch('https://example.test', {}, { signal: controller.signal, timeoutMs: 5_000 })
  controller.abort(new Error('user navigated away'))
  // Caller-initiated aborts must NOT be relabelled as timeouts — the router relies
  // on this distinction to avoid treating a user cancel as a provider failure.
  await assert.rejects(promise, (error: Error) => !/timed out/.test(error.message))
})

test('aiFetch returns the response unchanged on success', async () => {
  const expected = new Response('ok', { status: 200 })
  globalThis.fetch = (() => Promise.resolve(expected)) as typeof fetch
  const result = await aiFetch('https://example.test', {}, { timeoutMs: 1_000 })
  assert.equal(result, expected)
})

test('aiFetch rejects immediately when the caller signal is already aborted', async () => {
  hangingFetch()
  const controller = new AbortController()
  controller.abort(new Error('already gone'))
  await assert.rejects(
    aiFetch('https://example.test', {}, { signal: controller.signal, timeoutMs: 5_000 }),
    /already gone/,
  )
})
