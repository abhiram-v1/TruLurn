// Process-level in-memory cache: TTL + LRU eviction + single-flight loading +
// tag-based invalidation. Designed for read-mostly hot data (course structure,
// derived graph data) so the app stops re-hitting MongoDB on every navigation.
//
// Trade-offs / guarantees:
//  - Bounded memory: hard cap on entry count with LRU eviction.
//  - Self-healing: every entry has a TTL, so even a missed invalidation goes
//    stale for at most that TTL.
//  - Single-flight: concurrent misses for the same key share ONE loader call,
//    preventing a thundering herd against the DB on cold keys.
//  - Per-instance: on multi-instance/serverless deployments each instance keeps
//    its own cache; correctness is preserved (TTL-bounded staleness). On a
//    long-lived server (dev or a single Node process) it eliminates almost all
//    redundant reads.

type CacheEntry<T> = {
  value: T
  expiresAt: number
  tags: string[]
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  size: number
  inflight: number
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>()
  private tagIndex = new Map<string, Set<string>>()
  private inflight = new Map<string, Promise<unknown>>()
  private hits = 0
  private misses = 0
  private evictions = 0
  private readonly maxEntries: number

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries
  }

  private indexTags(key: string, tags: string[]) {
    for (const tag of tags) {
      let set = this.tagIndex.get(tag)
      if (!set) {
        set = new Set()
        this.tagIndex.set(tag, set)
      }
      set.add(key)
    }
  }

  private deindexTags(key: string, tags: string[]) {
    for (const tag of tags) {
      const set = this.tagIndex.get(tag)
      if (!set) continue
      set.delete(key)
      if (!set.size) this.tagIndex.delete(tag)
    }
  }

  /** Remove an entry and clean its tag index. */
  delete(key: string): void {
    const entry = this.store.get(key)
    if (!entry) return
    this.store.delete(key)
    this.deindexTags(key, entry.tags)
  }

  /** Read a live (non-expired) value, bumping it to most-recently-used. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) {
      this.misses += 1
      return undefined
    }
    if (entry.expiresAt <= Date.now()) {
      this.delete(key)
      this.misses += 1
      return undefined
    }
    // LRU bump: reinsert so iteration order puts this key last (newest).
    this.store.delete(key)
    this.store.set(key, entry)
    this.hits += 1
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs: number, tags: string[] = []): void {
    const existing = this.store.get(key)
    if (existing) this.deindexTags(key, existing.tags)
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, tags })
    this.indexTags(key, tags)
    this.evictIfNeeded()
  }

  /** Evict least-recently-used entries until under the cap. */
  private evictIfNeeded() {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      this.delete(oldestKey)
      this.evictions += 1
    }
  }

  /**
   * Return the cached value, or run `loader` once to populate it. Concurrent
   * callers for the same key await a single in-flight load. Rejections are not
   * cached.
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options: { ttlMs: number; tags?: string[] },
  ): Promise<T> {
    const cached = this.get<T>(key)
    if (cached !== undefined) return cached

    const pending = this.inflight.get(key)
    if (pending) return pending as Promise<T>

    const promise = (async () => {
      try {
        const value = await loader()
        // Don't cache `undefined` — it is indistinguishable from a miss.
        if (value !== undefined) this.set(key, value, options.ttlMs, options.tags ?? [])
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, promise)
    return promise
  }

  /** Drop every entry carrying a tag. The core invalidation primitive. */
  invalidateTag(tag: string): number {
    const keys = this.tagIndex.get(tag)
    if (!keys) return 0
    let count = 0
    for (const key of [...keys]) {
      this.delete(key)
      count += 1
    }
    return count
  }

  invalidateTags(tags: string[]): number {
    return tags.reduce((sum, tag) => sum + this.invalidateTag(tag), 0)
  }

  clear(): void {
    this.store.clear()
    this.tagIndex.clear()
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.store.size,
      inflight: this.inflight.size,
    }
  }
}

// HMR-safe singleton: reuse one cache across dev module reloads and route calls.
const globalForCache = globalThis as typeof globalThis & {
  _trulurnMemoryCache?: MemoryCache
}

export const appCache: MemoryCache =
  globalForCache._trulurnMemoryCache ?? new MemoryCache(
    Number(process.env.APP_CACHE_MAX_ENTRIES) || 5000,
  )

if (process.env.NODE_ENV !== 'production') {
  globalForCache._trulurnMemoryCache = appCache
}
