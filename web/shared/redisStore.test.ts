import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheStatus, checkedRedisStatus, dayReport, redisStatus } from './cacheStats'
import { fakeConnection, fakeRedis } from './fakeRedis'
import { readMemory, reconnectDelayMs } from './redisClient'
import { type RedisCommands, redisStore, REST_MS } from './redisStore'
import { memoryStore } from './store'

/** Lets the counters' unwaited adds land. */
const settle = () => new Promise<void>((done) => setImmediate(done))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the store with a read endpoint: two connections', () => {
  it('reads cached values from the replica, and everything else from the primary', async () => {
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    await store.cache.set('copilot:q', 'answer', 60)
    expect(await store.cache.get('copilot:q')).toBe('answer')
    await store.limiter('chat', 2, 60_000).attempt('visitor')
    const token = await store.locks?.acquire('copilot:q', 1000)
    await store.locks?.release('copilot:q', token ?? '')
    await settle()
    // The cache read is the only call that went to the replica. The limit, the lock and its
    // release, the write and the counter all went to the primary.
    expect(redis.calls).toEqual(['setEx', 'getFromReplica', 'increment', 'slidingWindow', 'setNew', 'deleteIf'])
  })

  it('never reads a rate limit from the replica, even when the replica is the only one answering', async () => {
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    redis.down = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const limit = store.limiter('chat', 1, 60_000)
    // The primary is down: the limit is counted in this copy's memory, not asked of the replica.
    expect([await limit.take('v'), await limit.take('v')]).toEqual([true, false])
    expect(redis.calls.filter((call) => call === 'getFromReplica')).toEqual([])
  })

  it('a replica that is behind gives a miss, never a wrong answer; `fresh` reads the primary', async () => {
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    redis.replicaBehind = true
    await store.cache.set('copilot:q', 'answer', 60)
    expect(await store.cache.get('copilot:q')).toBeNull()
    expect(await store.cache.fresh?.('copilot:q')).toBe('answer')
    redis.syncReplica()
    expect(await store.cache.get('copilot:q')).toBe('answer')
  })

  it('falls back from the read endpoint to the primary, then to a miss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let time = 0
    const redis = fakeRedis(() => time)
    const store = redisStore(redis, memoryStore(() => time), () => time)
    await store.cache.set('speak:s', 'audio', 60)

    redis.replicaDown = true
    expect(await store.cache.get('speak:s')).toBe('audio')
    expect(redis.calls.slice(-3)).toEqual(['getFromReplica', 'get', 'increment'])
    // For the next 2 s the read endpoint is left alone: reads go straight to the primary.
    redis.calls.length = 0
    expect(await store.cache.get('speak:s')).toBe('audio')
    expect(redis.calls).toEqual(['get', 'increment'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('read endpoint')
    // The store itself never failed: the status still says it is on Redis.
    expect(redisStatus(store, fakeConnection()).state).toBe('redis')

    // Both away: this copy's memory answers, which is a miss for a value it never kept itself.
    redis.down = true
    time += REST_MS
    expect(await store.cache.get('speak:s')).toBeNull()
    expect(redisStatus(store, fakeConnection()).state).toBe('fallback')

    // Back: the replica is asked again once its rest is over.
    redis.down = false
    redis.replicaDown = false
    time += REST_MS
    redis.calls.length = 0
    expect(await store.cache.get('speak:s')).toBe('audio')
    expect(redis.calls[0]).toBe('getFromReplica')
  })

  it('without a read endpoint, reads go to the primary exactly as before', async () => {
    const { getFromReplica: _none, ...primaryOnly } = fakeRedis(() => 0)
    const calls = primaryOnly.calls
    const store = redisStore(primaryOnly as RedisCommands, memoryStore(() => 0), () => 0)
    await store.cache.set('copilot:q', 'answer', 60)
    expect(await store.cache.get('copilot:q')).toBe('answer')
    expect(calls.slice(0, 2)).toEqual(['setEx', 'get'])
  })
})

describe('the store when Redis goes quiet without closing the connection (a failover that hangs)', () => {
  it('pays the 300 ms of patience once, then answers from memory at once for 2 s, then tries again', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis()
    const store = redisStore(redis, memoryStore())
    const limit = store.limiter('chat', 5, 60_000)
    expect(await limit.take('v')).toBe(true)

    redis.hung = true
    const started = Date.now()
    const slow = limit.take('v')
    await vi.advanceTimersByTimeAsync(300)
    expect(await slow).toBe(true)
    expect(Date.now() - started).toBe(300)

    // Resting: the next calls to the primary are not made, and do not wait.
    redis.calls.length = 0
    const before = Date.now()
    expect(await limit.take('v')).toBe(true)
    expect(await limit.take('v')).toBe(true)
    expect(Date.now() - before).toBe(0)
    expect(redis.calls).toEqual([])
    // The read endpoint is another connection, so it is given its own one try, and then rests too.
    const read = store.cache.get('copilot:q')
    await vi.advanceTimersByTimeAsync(300)
    expect(await read).toBeNull()
    const again = Date.now()
    expect(await store.cache.get('copilot:q')).toBeNull()
    expect(Date.now() - again).toBe(0)
    expect(redis.calls).toEqual(['getFromReplica'])
    redis.calls.length = 0

    // After the rest, one call tries Redis again. It is back, and so is the store.
    await vi.advanceTimersByTimeAsync(REST_MS)
    redis.hung = false
    expect(await limit.take('v')).toBe(true)
    expect(redis.calls).toEqual(['slidingWindow'])
    expect(redisStatus(store, fakeConnection()).state).toBe('redis')
  })

  it('asks for a new connection after three calls in a row got no answer, counting calls made together once', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis()
    const store = redisStore(redis, memoryStore())
    const limit = store.limiter('chat', 50, 60_000)
    redis.hung = true
    for (const expected of [0, 0, 1]) {
      // A request makes several calls at once: they time out together and count as one.
      const together = Promise.all([limit.take('a'), limit.take('b'), limit.take('c')])
      await vi.advanceTimersByTimeAsync(300)
      await together
      expect(redis.reconnects).toBe(expected)
      await vi.advanceTimersByTimeAsync(REST_MS)
    }
  })

  it('a connection that has dropped fails at once, with no rest: the next call asks Redis again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    const limit = store.limiter('chat', 5, 60_000)
    redis.down = true
    expect(await limit.take('v')).toBe(true)
    redis.down = false
    redis.calls.length = 0
    expect(await limit.take('v')).toBe(true)
    expect(redis.calls).toEqual(['slidingWindow'])
  })
})

describe('what the status says about the store', () => {
  it('says redis, fallback, reconnecting or memory, truthfully', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis(() => 0)
    let time = 0
    const store = redisStore(redis, memoryStore(() => time), () => time)
    const limit = store.limiter('chat', 50, 60_000)
    expect(redisStatus(memoryStore(), undefined)).toEqual({ state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 })
    expect(redisStatus(store, fakeConnection({ readEndpoint: 'ready' }))).toEqual({ state: 'redis', readEndpoint: 'ready', connections: 1, fallbacks: 0 })

    // The client still believes it is connected, but a call failed: this request was served from memory.
    redis.down = true
    time = 1000
    await limit.take('v')
    expect(redisStatus(store, fakeConnection())).toMatchObject({ state: 'fallback', fallbacks: 1 })
    // The client knows the connection is down and is re-making it.
    expect(redisStatus(store, fakeConnection({ primary: 'reconnecting', readEndpoint: 'reconnecting' }))).toMatchObject({ state: 'reconnecting', readEndpoint: 'reconnecting' })

    redis.down = false
    time = 2000
    await limit.take('v')
    expect(redisStatus(store, fakeConnection({ connections: 2 }))).toEqual({ state: 'redis', readEndpoint: 'none', connections: 2, fallbacks: 1 })
  })

  it('asks Redis once more before saying fallback, so a copy with no request since Redis came back says redis', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    redis.down = true
    await store.limiter('chat', 5, 60_000).take('v')
    // Still down: the one more read fails too, and the answer is honest.
    expect((await checkedRedisStatus(store, fakeConnection())).state).toBe('fallback')
    // Back, and nobody has asked this copy anything since: the status finds out for itself.
    redis.down = false
    expect(redisStatus(store, fakeConnection()).state).toBe('fallback')
    expect((await checkedRedisStatus(store, fakeConnection())).state).toBe('redis')
    // A copy that is reconnecting answers without asking Redis anything.
    redis.calls.length = 0
    await checkedRedisStatus(store, fakeConnection({ primary: 'reconnecting' }))
    expect(redis.calls).toEqual([])
  })

  it('asks Redis once even when the last call worked, so a copy with no request since Redis froze does not say redis', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redis = fakeRedis(() => 0)
    const store = redisStore(redis, memoryStore(() => 0), () => 0)
    await store.limiter('chat', 5, 60_000).take('v')
    expect(redisStatus(store, fakeConnection()).state).toBe('redis')
    // The connection is still open as far as the client knows, but Redis stopped answering.
    redis.down = true
    redis.calls.length = 0
    expect((await checkedRedisStatus(store, fakeConnection())).state).toBe('fallback')
    expect(redis.calls).toEqual(['get'])
  })
})

describe('hit rates and single flights, counted in Redis', () => {
  it('counts hits and misses per kind of key, shared by every copy, by day', async () => {
    const DAY_MS = 24 * 60 * 60_000
    let time = Date.UTC(2026, 10, 12, 23, 59)
    const redis = fakeRedis(() => time)
    const [web, copilot] = [redisStore(redis, memoryStore(() => time), () => time), redisStore(redis, memoryStore(() => time), () => time)]
    await copilot.cache.get('copilot:q1')
    await copilot.cache.set('copilot:q1', 'a', 60)
    await copilot.cache.get('copilot:q1')
    await web.cache.get('copilot:q1')
    await web.cache.get('speak:s1')
    copilot.counts?.add('flight:copilot:led')
    copilot.counts?.add('flight:copilot:waited')
    copilot.counts?.add('flight:copilot:waited')
    copilot.counts?.add('cluster:copilot:fell-back')
    await settle()
    time += 2 * 60_000
    await web.cache.get('speak:s1')
    await settle()

    const days = await web.counts?.read(2)
    expect(days?.map(({ day, counts }) => dayReport(day, counts))).toEqual([
      { day: '2026-11-13', cache: { speak: { hits: 0, misses: 1, hitRate: 0 } }, flights: {}, clusterFellBack: {} },
      { day: '2026-11-12', cache: { copilot: { hits: 2, misses: 1, hitRate: 0.667 }, speak: { hits: 0, misses: 1, hitRate: 0 } }, flights: { copilot: { led: 1, waited: 2 } }, clusterFellBack: { copilot: 1 } },
    ])
    // A look that must see the latest write is not a read a visitor made: it is not counted.
    await copilot.cache.fresh?.('copilot:q1')
    await settle()
    expect((await web.counts?.read(1))?.[0].counts).toEqual({ 'cache:speak:miss': 1 })
    expect(time % DAY_MS).toBeGreaterThan(0)
  })

  it('never fails or slows a read when the counter cannot be written', async () => {
    const redis = fakeRedis(() => 0)
    const store = redisStore({ ...redis, increment: () => Promise.reject(new Error('READONLY')) }, memoryStore(() => 0), () => 0)
    await store.cache.set('copilot:q', 'a', 60)
    expect(await store.cache.get('copilot:q')).toBe('a')
  })

  it('reports the days, the memory and the store state, and reuses the answer for 5 s', async () => {
    let time = Date.UTC(2026, 10, 12, 12)
    const redis = fakeRedis(() => time)
    const store = redisStore(redis, memoryStore(() => time), () => time)
    await store.cache.get('copilot:q')
    await settle()
    const read = cacheStatus(store, fakeConnection({ readEndpoint: 'ready' }), () => time)
    const first = await read()
    expect(first).toEqual({
      redis: { state: 'redis', readEndpoint: 'ready', connections: 1, fallbacks: 0 },
      days: [
        { day: '2026-11-12', cache: { copilot: { hits: 0, misses: 1, hitRate: 0 } }, flights: {}, clusterFellBack: {} },
        { day: '2026-11-11', cache: {}, flights: {}, clusterFellBack: {} },
      ],
      memory: { usedBytes: 1_000_000, maxBytes: 0 },
      readAt: '2026-11-12T12:00:00.000Z',
    })
    redis.calls.length = 0
    time += 4000
    // Reused: no counters and no INFO, only the status's one small read to check Redis answers.
    expect((await read()).readAt).toBe(first.readAt)
    expect(redis.calls).toEqual(['get'])
    time += 2000
    expect((await read()).readAt).not.toBe(first.readAt)

    // With no Redis there is nothing to read, and it says so without failing.
    expect(await cacheStatus(memoryStore(), undefined, () => time)()).toEqual({ redis: { state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 }, days: [], memory: null, readAt: new Date(time).toISOString() })
  })
})

describe('the connection', () => {
  it('waits longer before each reconnect, up to 2 s, with half of each wait random', () => {
    expect([0, 1, 2, 3, 4, 9].map((retries) => reconnectDelayMs(retries, () => 0))).toEqual([100, 200, 400, 800, 1000, 1000])
    expect([0, 1, 2, 3, 4, 9].map((retries) => reconnectDelayMs(retries, () => 0.999999))).toEqual([200, 400, 800, 1600, 2000, 2000])
    // A very long outage does not overflow into a wait of no time or forever.
    expect(reconnectDelayMs(5000, () => 0.5)).toBe(1500)
  })

  it('reads the memory in use and the limit out of INFO', () => {
    const info = '# Memory\r\nused_memory:1234567\r\nused_memory_human:1.18M\r\nused_memory_peak:2345678\r\nmaxmemory:1073741824\r\nmaxmemory_policy:volatile-lru\r\n'
    expect(readMemory(info)).toEqual({ usedBytes: 1234567, maxBytes: 1073741824 })
    expect(readMemory('')).toEqual({ usedBytes: 0, maxBytes: 0 })
  })
})
