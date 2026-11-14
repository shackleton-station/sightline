import { describe, expect, it, vi } from 'vitest'
import { BREAKER, BREAKER_KEY, type BreakerRedis, breakerOver, memoryBreaker, redisBreaker } from './breaker'

/** A stand-in for Redis that does what the compare-and-set script does, so two "copies" can share it. */
function fakeRedis() {
  const values = new Map<string, string>()
  const fake = {
    down: false,
    writes: 0,
    values,
    get: vi.fn(async (key: string) => {
      if (fake.down) throw new Error('connection refused')
      return values.get(key) ?? null
    }),
    compareAndSet: vi.fn(async (key: string, expected: string | null, next: string) => {
      if (fake.down) throw new Error('connection refused')
      if ((values.get(key) ?? null) !== expected) return false
      values.set(key, next)
      fake.writes += 1
      return true
    }),
  }
  return fake satisfies BreakerRedis & Record<string, unknown>
}

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('the circuit breaker', () => {
  it('opens after 5 failed calls within a minute, refuses with the time left, then lets one trial through', async () => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    for (let i = 0; i < 4; i++) {
      expect(await breaker.admit()).toEqual({ allowed: true, trial: false })
      time += 1000
      await breaker.failed(false)
    }
    expect((await breaker.peek()).state).toBe('closed')
    await breaker.failed(false)
    expect(await breaker.peek()).toEqual({ state: 'open', retryAfterMs: BREAKER.openMs })

    time += 10_000
    expect(await breaker.admit()).toEqual({ allowed: false, state: 'open', retryAfterMs: 20_000 })

    // After 30 s: half-open. The first to ask gets the trial; the rest wait for it.
    time += 20_000
    expect(await breaker.peek()).toEqual({ state: 'half-open', retryAfterMs: 0 })
    expect(await breaker.admit()).toEqual({ allowed: true, trial: true })
    expect(await breaker.admit()).toEqual({ allowed: false, state: 'half-open', retryAfterMs: BREAKER.trialMs })

    // The trial works: closed again, with no failures remembered.
    await breaker.succeeded(true)
    expect(await breaker.peek()).toEqual({ state: 'closed', retryAfterMs: 0 })
    await breaker.failed(false)
    expect((await breaker.peek()).state).toBe('closed')
  })

  it('counts failures over a sliding minute: old ones fall out', async () => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    for (let i = 0; i < 4; i++) await breaker.failed(false)
    time = 61_000
    await breaker.failed(false)
    expect((await breaker.peek()).state).toBe('closed')
  })

  it('opens again for another 30 s when the trial fails', async () => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    time = 30_000
    expect(await breaker.admit()).toEqual({ allowed: true, trial: true })
    time = 32_000
    await breaker.failed(true)
    expect(await breaker.peek()).toEqual({ state: 'open', retryAfterMs: 30_000 })
  })

  it('gives the trial to someone else if the one holding it never reports', async () => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    time = 30_000
    expect((await breaker.admit()).allowed).toBe(true)
    time = 30_000 + BREAKER.trialMs
    expect(await breaker.admit()).toEqual({ allowed: true, trial: true })
  })

  it('takes no notice of a late success or failure from a call that started before it opened', async () => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    await breaker.succeeded(false)
    expect((await breaker.peek()).state).toBe('open')
    await breaker.failed(false)
    expect(await breaker.peek()).toEqual({ state: 'open', retryAfterMs: 30_000 })
  })

  it('is shared through Redis: what one copy sees, every copy obeys', async () => {
    let time = 0
    const redis = fakeRedis()
    const copyA = redisBreaker(redis, memoryBreaker(() => time), () => time)
    const copyB = redisBreaker(redis, memoryBreaker(() => time), () => time)
    // Failures seen by two different copies add up.
    for (let i = 0; i < 3; i++) await copyA.failed(false)
    for (let i = 0; i < 2; i++) await copyB.failed(false)
    expect(redis.values.has(BREAKER_KEY)).toBe(true)
    expect((await copyA.peek()).state).toBe('open')
    expect((await copyB.admit()).allowed).toBe(false)

    // One trial for all the copies together.
    time = 30_000
    expect(await copyA.admit()).toEqual({ allowed: true, trial: true })
    expect((await copyB.admit()).allowed).toBe(false)
    await copyA.succeeded(true)
    expect(await copyB.admit()).toEqual({ allowed: true, trial: false })
  })

  it('does not lose a change when two copies write at the same moment: the loser reads again', async () => {
    let time = 0
    const redis = fakeRedis()
    const real = redis.compareAndSet.getMockImplementation()
    // The first write from copy A loses a race to copy B, which writes in between.
    const copyB = redisBreaker(redis, memoryBreaker(() => time), () => time)
    let raced = false
    redis.compareAndSet.mockImplementation(async (key: string, expected: string | null, next: string) => {
      if (!raced) {
        raced = true
        await copyB.failed(false)
      }
      return (real as NonNullable<typeof real>)(key, expected, next)
    })
    const copyA = redisBreaker(redis, memoryBreaker(() => time), () => time)
    await copyA.failed(false)
    expect(JSON.parse(redis.values.get(BREAKER_KEY) ?? '{}').failures).toHaveLength(2)
  })

  it('falls back to this copy’s memory while Redis is down, and still protects the copy', async () => {
    const warn = quiet()
    let time = 0
    const redis = fakeRedis()
    redis.down = true
    const breaker = redisBreaker(redis, memoryBreaker(() => time), () => time)
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    expect((await breaker.admit()).allowed).toBe(false)
    // Once about Redis (once a minute at most), and once that it opened.
    expect(warn.mock.calls.map(([message]) => String(message).slice(0, 32))).toEqual(['Circuit breaker: Redis unavailab', 'Circuit breaker opened (memory):'])
    warn.mockRestore()
  })

  it('reads a damaged record as closed rather than failing a question', async () => {
    const breaker = breakerOver({ read: async () => 'not json', write: async () => true }, 'memory')
    expect(await breaker.admit()).toEqual({ allowed: true, trial: false })
  })
})
