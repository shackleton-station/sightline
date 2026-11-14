import { describe, expect, it } from 'vitest'
import { fakeRedis } from './fakeRedis'
import { jitteredSeconds } from './jitter'
import { redisStore } from './redisStore'
import { memoryStore } from './store'

const DAY_S = 24 * 60 * 60

/** A fixed sequence of "random" numbers, repeated: the seed a test controls. */
const sequence = (...values: number[]) => {
  let n = 0
  return () => values[n++ % values.length]
}

describe('expiry with jitter', () => {
  it('is the base time plus or minus 10%, and the same seed gives the same expiry', () => {
    expect(jitteredSeconds(DAY_S, () => 0)).toBe(DAY_S * 0.9)
    expect(jitteredSeconds(DAY_S, () => 0.5)).toBe(DAY_S)
    expect(jitteredSeconds(DAY_S, () => 0.999999)).toBeLessThanOrEqual(DAY_S * 1.1)
    expect(jitteredSeconds(DAY_S, () => 0.25)).toBe(jitteredSeconds(DAY_S, () => 0.25))
    // Never zero: an expiry of 0 would mean "now", or "never", depending on who is asked.
    expect(jitteredSeconds(1, () => 0)).toBe(1)
  })

  it('stays inside the 10% for any random number, and uses the whole range', () => {
    const picked = Array.from({ length: 1000 }, () => jitteredSeconds(DAY_S))
    expect(Math.min(...picked)).toBeGreaterThanOrEqual(DAY_S * 0.9)
    expect(Math.max(...picked)).toBeLessThanOrEqual(DAY_S * 1.1)
    // A thousand writes in the same instant expire across hours, not within the same minute.
    expect(Math.max(...picked) - Math.min(...picked)).toBeGreaterThan(4 * 60 * 60)
  })

  it('is chosen per write on Redis: two entries written together expire apart', async () => {
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0, sequence(0, 0.999999))
    await store.cache.set('copilot:a', 'x', DAY_S)
    await store.cache.set('copilot:b', 'y', DAY_S)
    expect(redis.ttl('clps:cache:copilot:a')).toBe(DAY_S * 0.9)
    expect(redis.ttl('clps:cache:copilot:b')).toBe(Math.round(DAY_S * 1.0999998))
  })

  it('is chosen per write in memory too', async () => {
    let time = 0
    const store = memoryStore(() => time, sequence(0, 0.999999))
    await store.cache.set('a', 'x', 100)
    await store.cache.set('b', 'y', 100)
    time = 95_000
    expect([await store.cache.get('a'), await store.cache.get('b')]).toEqual([null, 'y'])
    time = 111_000
    expect(await store.cache.get('b')).toBeNull()
  })

  it('leaves a rate limit window exactly as long as it says', async () => {
    let time = 0
    for (const store of [memoryStore(() => time, () => 0), redisStore(fakeRedis(() => time), memoryStore(() => time), () => time, () => 0)]) {
      time = 0
      const limit = store.limiter('exact', 1, 60_000)
      expect(await limit.take('v')).toBe(true)
      time = 59_999
      expect(await limit.take('v')).toBe(false)
      time = 60_000
      expect(await limit.take('v')).toBe(true)
    }
  })
})
