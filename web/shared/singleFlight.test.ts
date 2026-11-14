import { describe, expect, it } from 'vitest'
import { fakeRedis } from './fakeRedis'
import { redisStore } from './redisStore'
import { FLIGHT, singleFlight } from './singleFlight'
import { memoryStore, type SharedStore } from './store'

/**
 * A clock the test owns. `sleep` waits until the clock reaches a time; `run` moves the clock from
 * one sleeper to the next, in order, letting everything that was woken finish before moving on.
 * Nothing here waits on real time.
 */
function fakeClock() {
  let time = 0
  const sleepers: { at: number; wake: () => void }[] = []
  const settle = async () => {
    for (let n = 0; n < 200; n += 1) await Promise.resolve()
  }
  return {
    now: () => time,
    sleep: (ms: number) => new Promise<void>((wake) => sleepers.push({ at: time + ms, wake })),
    /** Runs until `until` (ms on the clock), or until nobody is asleep. */
    async run(until = Number.POSITIVE_INFINITY) {
      await settle()
      for (;;) {
        sleepers.sort((a, b) => a.at - b.at)
        const next = sleepers[0]
        if (!next || next.at > until) break
        sleepers.shift()
        time = Math.max(time, next.at)
        next.wake()
        await settle()
      }
      if (until !== Number.POSITIVE_INFINITY) time = Math.max(time, until)
      await settle()
    },
  }
}

const KEY = 'copilot:question'
const DEADLINE_MS = 25_000

/** A copy of a service: its own store on the shared Redis, and work that takes `takesMs` and keeps its result. */
function copy(redis: ReturnType<typeof fakeRedis>, clock: ReturnType<typeof fakeClock>, options: { takesMs?: number; keeps?: boolean; calls?: { n: number } } = {}) {
  const store: SharedStore = redisStore(redis, memoryStore(clock.now), clock.now, () => 0.5)
  const calls = options.calls ?? { n: 0 }
  const fly = () =>
    singleFlight({
      key: KEY,
      locks: store.locks,
      read: () => store.cache.fresh?.(KEY) ?? Promise.resolve(null),
      compute: async () => {
        calls.n += 1
        const mine = calls.n
        await clock.sleep(options.takesMs ?? 4000)
        if (options.keeps !== false) await store.cache.set(KEY, `answer ${mine}`, 60)
        return `answer ${mine}`
      },
      deadline: clock.now() + DEADLINE_MS,
      now: clock.now,
      wait: clock.sleep,
      random: () => 0.5,
    })
  return { store, fly, calls }
}

describe('one recompute per key', () => {
  it('thirty requests at once, on three copies, make one model call, and all get its answer', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const calls = { n: 0 }
    const copies = [copy(redis, clock, { calls }), copy(redis, clock, { calls }), copy(redis, clock, { calls })]
    const flights = Array.from({ length: 30 }, (_, n) => copies[n % 3].fly())
    await clock.run()
    const results = await Promise.all(flights)

    expect(calls.n).toBe(1)
    expect(results.filter((result) => result.how === 'led')).toHaveLength(1)
    expect(results.filter((result) => result.how === 'waited')).toHaveLength(29)
    expect(results.every((result) => ('kept' in result ? result.kept : result.value) === 'answer 1')).toBe(true)
    // The waiters looked after 0.1, 0.25, 0.475 and 0.813 s, then every half second: eleven looks
    // each, the last one 313 ms after the answer was kept at 4 s.
    const waited = results.filter((result) => result.how === 'waited').map((result) => result.tookMs)
    expect(new Set(waited)).toEqual(new Set([4313]))
    expect(redis.calls.filter((call) => call === 'get')).toHaveLength(1 + 29 * 11)
    // The lock was released, not left to expire.
    expect(redis.keys()).toEqual(['clps:cache:copilot:question'])
  })

  it('a request that is alone takes the lock, looks again, works, and releases: three calls to Redis and no waiting', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const { fly } = copy(redis, clock)
    const flight = fly()
    await clock.run()
    expect(await flight).toEqual({ how: 'led', value: 'answer 1', tookMs: 4000 })
    expect(redis.calls).toEqual(['setNew', 'get', 'setEx', 'deleteIf'])
  })

  it('finds an answer that was kept between its miss and its lock, without working it out', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const { fly, store, calls } = copy(redis, clock)
    await store.cache.set(KEY, 'kept earlier', 60)
    const flight = fly()
    await clock.run()
    expect(await flight).toEqual({ how: 'found', kept: 'kept earlier', tookMs: 0 })
    expect(calls.n).toBe(0)
    expect(redis.keys()).toEqual(['clps:cache:copilot:question'])
  })

  it('the holder dies: its lock expires after 15 s, and one waiter takes over while the others wait for it', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    // A copy took the lock and stopped before it could answer or release.
    const dead = redisStore(redis, memoryStore(clock.now), clock.now)
    expect(await dead.locks?.acquire(KEY, FLIGHT.lockMs)).not.toBeNull()

    // One request arrives 6 s later: it may wait until 16 s on the clock, and the lock goes at 15 s.
    await clock.run(6000)
    const calls = { n: 0 }
    const { fly } = copy(redis, clock, { calls, takesMs: 2000 })
    const first = fly()
    // Two more arrive at 14 s. The lock is still the dead copy's.
    await clock.run(14_000)
    const later = [fly(), fly()]
    await clock.run()
    const results = await Promise.all([first, ...later])
    expect(calls.n).toBe(1)
    expect(results.map((result) => result.how)).toEqual(['took-over', 'waited', 'waited'])
    // It took over on its first look after the lock expired at 15 s: 9.313 s after it arrived.
    expect(results[0].tookMs).toBe(9313 + 2000)
  })

  it('the holder dies with waiters that cannot wait 15 s: they give up after 10 s and each works it out', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const dead = redisStore(redis, memoryStore(clock.now), clock.now)
    await dead.locks?.acquire(KEY, FLIGHT.lockMs)
    const calls = { n: 0 }
    const { fly } = copy(redis, clock, { calls, takesMs: 1000 })
    const flights = [fly(), fly()]
    await clock.run()
    const results = await Promise.all(flights)
    expect(results.map((result) => result.how)).toEqual(['gave-up', 'gave-up'])
    expect(calls.n).toBe(2)
    // They stopped waiting inside the 10 s, with time left to answer before the request's own deadline.
    for (const result of results) expect(result.tookMs - 1000).toBeLessThanOrEqual(FLIGHT.maxWaitMs)
  })

  it('never waits past what the request has left: with 13 s to its deadline it waits about 1 s, not 10', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const store = redisStore(redis, memoryStore(clock.now), clock.now)
    await store.locks?.acquire(KEY, FLIGHT.lockMs)
    let computedAt = -1
    const flight = singleFlight({
      key: KEY,
      locks: store.locks,
      read: () => store.cache.fresh?.(KEY) ?? Promise.resolve(null),
      compute: async () => {
        computedAt = clock.now()
        return 'late'
      },
      // 12 s are kept back to work the answer out, so only 1 s of the 13 may be spent waiting.
      deadline: clock.now() + 13_000,
      now: clock.now,
      wait: clock.sleep,
      random: () => 0.5,
    })
    await clock.run()
    expect((await flight).how).toBe('gave-up')
    expect(computedAt).toBeGreaterThan(0)
    expect(computedAt).toBeLessThanOrEqual(1000)
  })

  it('a holder that finishes with nothing worth keeping frees the lock, and the next waiter takes its turn', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const calls = { n: 0 }
    // The first answer is not kept (a refusal, or a failed model call). The second is.
    const first = copy(redis, clock, { calls, keeps: false, takesMs: 2000 })
    const second = copy(redis, clock, { calls, takesMs: 2000 })
    const flights = [first.fly(), second.fly(), second.fly()]
    await clock.run()
    const results = await Promise.all(flights)
    expect(results.map((result) => result.how)).toEqual(['led', 'took-over', 'waited'])
    expect(calls.n).toBe(2)
  })

  it('a holder that overran its lock does not delete the lock someone else has taken since', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const slow = redisStore(redis, memoryStore(clock.now), clock.now)
    const token = await slow.locks?.acquire(KEY, FLIGHT.lockMs)
    await clock.run(FLIGHT.lockMs + 1)
    const next = redisStore(redis, memoryStore(clock.now), clock.now)
    const theirs = await next.locks?.acquire(KEY, FLIGHT.lockMs)
    expect(theirs).not.toBeNull()
    // The late release compares its own token with the lock's, finds another's, and deletes nothing.
    await slow.locks?.release(KEY, token ?? '')
    expect(await next.locks?.acquire(KEY, FLIGHT.lockMs)).toBeNull()
  })

  it('without Redis it is today’s behaviour: every request works its answer out, at once', async () => {
    const clock = fakeClock()
    let calls = 0
    const fly = (locks: SharedStore['locks']) =>
      singleFlight({
        key: KEY,
        locks,
        read: async () => null,
        compute: async () => {
          calls += 1
          await clock.sleep(4000)
          return calls
        },
        deadline: DEADLINE_MS,
        now: clock.now,
        wait: clock.sleep,
      })
    // No Redis configured: the memory store has no locks.
    expect(memoryStore().locks).toBeUndefined()
    const alone = [fly(undefined), fly(undefined), fly(undefined)]
    await clock.run()
    expect((await Promise.all(alone)).map((result) => result.how)).toEqual(['alone', 'alone', 'alone'])
    expect(calls).toBe(3)

    // Redis configured but away: the lock cannot be asked for, and nobody waits.
    const redis = fakeRedis(clock.now)
    redis.down = true
    const store = redisStore(redis, memoryStore(clock.now), clock.now)
    const before = clock.now()
    const away = [fly(store.locks), fly(store.locks)]
    await clock.run()
    const results = await Promise.all(away)
    expect(results.map((result) => result.how)).toEqual(['no-lock', 'no-lock'])
    expect(results.map((result) => result.tookMs)).toEqual([0, 0])
    expect(clock.now() - before).toBe(4000)
    expect(calls).toBe(5)
  })

  it('Redis goes away while a request is waiting: it stops waiting and works the answer out', async () => {
    const clock = fakeClock()
    const redis = fakeRedis(clock.now)
    const holder = redisStore(redis, memoryStore(clock.now), clock.now)
    await holder.locks?.acquire(KEY, FLIGHT.lockMs)
    const { fly, calls } = copy(redis, clock, { takesMs: 1000 })
    const flight = fly()
    await clock.run(500)
    redis.down = true
    await clock.run()
    const result = await flight
    expect(result.how).toBe('no-lock')
    expect(calls.n).toBe(1)
    expect(result.tookMs).toBeLessThan(2000)
  })
})
