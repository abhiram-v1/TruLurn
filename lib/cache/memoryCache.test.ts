import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryCache } from './memoryCache.ts'

test('get returns set value before expiry, miss after', async () => {
  const cache = new MemoryCache()
  cache.set('a', 1, 1000)
  assert.equal(cache.get('a'), 1)
})

test('expired entries are evicted on read', async () => {
  const cache = new MemoryCache()
  cache.set('a', 1, -1) // already expired
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.stats().size, 0)
})

test('getOrLoad populates once and serves from cache', async () => {
  const cache = new MemoryCache()
  let calls = 0
  const load = () => { calls += 1; return Promise.resolve('v') }
  assert.equal(await cache.getOrLoad('k', load, { ttlMs: 1000 }), 'v')
  assert.equal(await cache.getOrLoad('k', load, { ttlMs: 1000 }), 'v')
  assert.equal(calls, 1)
})

test('single-flight: concurrent misses share one loader call', async () => {
  const cache = new MemoryCache()
  let calls = 0
  const load = () => {
    calls += 1
    return new Promise<string>((resolve) => setTimeout(() => resolve('v'), 20))
  }
  const [a, b, c] = await Promise.all([
    cache.getOrLoad('k', load, { ttlMs: 1000 }),
    cache.getOrLoad('k', load, { ttlMs: 1000 }),
    cache.getOrLoad('k', load, { ttlMs: 1000 }),
  ])
  assert.deepEqual([a, b, c], ['v', 'v', 'v'])
  assert.equal(calls, 1)
})

test('rejected loads are not cached and clear in-flight', async () => {
  const cache = new MemoryCache()
  await assert.rejects(
    cache.getOrLoad('k', () => Promise.reject(new Error('boom')), { ttlMs: 1000 }),
  )
  assert.equal(cache.stats().inflight, 0)
  // Next load should run fresh (previous failure not cached).
  assert.equal(await cache.getOrLoad('k', () => Promise.resolve('ok'), { ttlMs: 1000 }), 'ok')
})

test('invalidateTag drops all entries carrying that tag', async () => {
  const cache = new MemoryCache()
  cache.set('course:1:doc', { a: 1 }, 1000, ['course:1'])
  cache.set('course:1:topics', [1, 2], 1000, ['course:1'])
  cache.set('course:2:doc', { b: 1 }, 1000, ['course:2'])
  const dropped = cache.invalidateTag('course:1')
  assert.equal(dropped, 2)
  assert.equal(cache.get('course:1:doc'), undefined)
  assert.equal(cache.get('course:1:topics'), undefined)
  assert.notEqual(cache.get('course:2:doc'), undefined)
})

test('re-set rewrites tag index so stale tags do not resurrect keys', async () => {
  const cache = new MemoryCache()
  cache.set('k', 1, 1000, ['old'])
  cache.set('k', 2, 1000, ['new'])
  assert.equal(cache.invalidateTag('old'), 0) // key no longer under 'old'
  assert.equal(cache.get('k'), 2)
  assert.equal(cache.invalidateTag('new'), 1)
  assert.equal(cache.get('k'), undefined)
})

test('LRU eviction removes least-recently-used past the cap', async () => {
  const cache = new MemoryCache(2)
  cache.set('a', 1, 1000)
  cache.set('b', 2, 1000)
  cache.get('a')          // 'a' becomes most-recently-used
  cache.set('c', 3, 1000) // over cap → evict LRU, which is 'b'
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('c'), 3)
  assert.equal(cache.stats().evictions, 1)
})

test('stats track hits and misses', async () => {
  const cache = new MemoryCache()
  cache.set('a', 1, 1000)
  cache.get('a') // hit
  cache.get('z') // miss
  const stats = cache.stats()
  assert.equal(stats.hits, 1)
  assert.equal(stats.misses, 1)
})
