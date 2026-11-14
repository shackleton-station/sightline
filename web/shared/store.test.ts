import { describe, expect, it, vi } from 'vitest'
import { type RedisCommands, redisStore } from './redisStore'
import { memoryStore } from './store'

/** A stand-in for Redis that keeps the same sorted sets the real script does. */
function fakeRedis(): RedisCommands & { down: boolean } {
  const sets = new Map<string, number[]>()
  const values = new Map<string, string>()
  const up = <T>(work: () => T): Promise<T> => (fake.down ? Promise.reject(new Error('connection refused')) : Promise.resolve(work()))
  const fake = {
    down: false,
    slidingWindow: (key: string, nowMs: number, windowMs: number, limit: number, member: string) =>
      up(() => {
        const recent = (sets.get(key) ?? []).filter((at) => at > nowMs - windowMs)
        if (recent.length >= limit) {
          sets.set(key, recent)
          // As the script: minus the wait until the oldest call that counts leaves the window.
          return -Math.max(1, recent[recent.length - limit] + windowMs - nowMs)
        }
        // As the script: with no name for the call it is looked at, not counted.
        sets.set(key, member === '' ? recent : [...recent, nowMs])
        return 1
      }),
    get: (key: string) => up(() => values.get(key) ?? null),
    setEx: (key: string, _ttl: number, value: string) => up(() => void values.set(key, value)),
  }
  return fake
}

describe('the shared store', () => {
  it('says how long to wait after a refusal, in memory and on Redis alike', async () => {
    let time = 0
    for (const store of [memoryStore(() => time), redisStore(fakeRedis(), memoryStore(() => time), () => time)]) {
      time = 0
      const limit = store.limiter('wait', 2, 60_000)
      expect(await limit.attempt('a')).toEqual({ allowed: true, retryAfterMs: 0 })
      time = 10_000
      expect(await limit.attempt('a')).toEqual({ allowed: true, retryAfterMs: 0 })
      time = 15_000
      // The first call (at 0) leaves the window at 60 s: 45 s from now.
      expect(await limit.attempt('a')).toEqual({ allowed: false, retryAfterMs: 45_000 })
      time = 60_000
      expect((await limit.attempt('a')).allowed).toBe(true)
      expect(await limit.attempt('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
    }
  })

  it('can look at a limit without counting the call, in memory and on Redis alike', async () => {
    let time = 0
    for (const store of [memoryStore(() => time), redisStore(fakeRedis(), memoryStore(() => time), () => time)]) {
      time = 0
      const limit = store.limiter('look', 2, 60_000)
      // Any number of looks leave the two places free.
      for (let n = 0; n < 5; n++) expect(await limit.peek('a')).toEqual({ allowed: true, retryAfterMs: 0 })
      expect((await limit.attempt('a')).allowed).toBe(true)
      time = 10_000
      expect((await limit.attempt('a')).allowed).toBe(true)
      time = 15_000
      // Full: a look says what a counted call would be told, and looking again does not move the wait.
      expect(await limit.peek('a')).toEqual({ allowed: false, retryAfterMs: 45_000 })
      expect(await limit.peek('a')).toEqual({ allowed: false, retryAfterMs: 45_000 })
      expect(await limit.attempt('a')).toEqual({ allowed: false, retryAfterMs: 45_000 })
      time = 60_000
      expect((await limit.peek('a')).allowed).toBe(true)
      expect((await limit.attempt('a')).allowed).toBe(true)
    }
  })

  it('in memory: counts a sliding window per key, and forgets cached values when they expire', async () => {
    let time = 0
    // The middle of the jitter (0.5) keeps a cached value for exactly what was asked.
    const store = memoryStore(() => time, () => 0.5)
    const limit = store.limiter('test', 2, 1000)
    expect([await limit.take('a'), await limit.take('a'), await limit.take('a'), await limit.take('b')]).toEqual([true, true, false, true])
    time = 1001
    expect(await limit.take('a')).toBe(true)

    await store.cache.set('k', 'v', 10)
    expect(await store.cache.get('k')).toBe('v')
    time += 10_001
    expect(await store.cache.get('k')).toBeNull()
  })

  it('on Redis: two copies of the server share one limit and one cache', async () => {
    const redis = fakeRedis()
    const [first, second] = [redisStore(redis, memoryStore(() => 0), () => 0), redisStore(redis, memoryStore(() => 0), () => 0)]
    const [a, b] = [first.limiter('chat', 2, 60_000), second.limiter('chat', 2, 60_000)]
    expect([await a.take('visitor'), await b.take('visitor'), await a.take('visitor'), await b.take('visitor')]).toEqual([true, true, false, false])
    // A different limit name is a different count, even for the same visitor.
    expect(await first.limiter('ask', 2, 60_000).take('visitor')).toBe(true)

    await first.cache.set('question', 'answer', 60)
    expect(await second.cache.get('question')).toBe('answer')
    expect(first.kind).toBe('redis')
  })

  it('on Redis: when it is down, each copy carries on from its own memory and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis()
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    const limit = store.limiter('chat', 1, 60_000)
    redis.down = true
    expect([await limit.take('visitor'), await limit.take('visitor')]).toEqual([true, false])
    await store.cache.set('question', 'answer', 60)
    expect(await store.cache.get('question')).toBe('answer')
    expect(warn).toHaveBeenCalledTimes(1)

    // Back up: Redis is the source of truth again, with its own count.
    redis.down = false
    expect(await limit.take('visitor')).toBe(true)
    warn.mockRestore()
  })
})
