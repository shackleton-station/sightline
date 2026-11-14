import { describe, expect, it, vi } from 'vitest'
import { dayReport } from '../../shared/cacheStats'
import { fakeRedis } from '../../shared/fakeRedis'
import type { QuestionEvent } from '../../shared/events'
import { redisStore } from '../../shared/redisStore'
import { FLIGHT } from '../../shared/singleFlight'
import { memoryStore } from '../../shared/store'
import { createCopilotApp } from '../app'
import { clusterCache } from '../clusterCache'
import type { Model, ModelRequest } from '../model'
import type { Relay } from '../outbox'
import { apiError, scriptedModel } from '../standIns'
import { dataDir, ORIGIN } from '../testing'
import { answerKey, answerVersion, WAITING_STEP } from './handler'

/**
 * One recompute per key, through the real handler: several copies of the co-pilot service on one
 * stand-in Redis, a model that answers only when the test lets it, and a clock
 * the test owns. The lock's own logic, on a clock with no real time in it, is tested in
 * shared/singleFlight.test.ts.
 */
const VIEW = '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn'
const TALK = { messages: [{ role: 'user', text: 'How sunny is it?' }], view: VIEW }
const ask = (n: number, init: { stream?: boolean; body?: unknown } = {}) =>
  new Request(`${ORIGIN}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': `203.0.113.${n}`, ...(init.stream ? { accept: 'text/event-stream' } : {}) },
    body: JSON.stringify(init.body ?? TALK),
  })

/** The scripted stand-in, held until the test lets it answer. It makes two model calls per question. */
function heldModel() {
  let release = () => {}
  const held = new Promise<void>((free) => {
    release = free
  })
  const inner = scriptedModel()
  const generate = vi.fn(async (request: ModelRequest, signal: AbortSignal) => {
    await held
    return inner.generate(request, signal)
  })
  return { model: { generate } as Model, generate, release }
}

const realPause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
/** Waiters look again after a real millisecond, so a test runs in a moment; the clock they read is the test's. */
const flight = { wait: () => realPause(1), random: () => 0.5 }
const VERSIONS = { version: 'test', codeVersion: 'c0de', dataVersion: 'da7a', revision: null }
const KEY = answerKey(answerVersion('c0de', 'da7a'), TALK.messages[0].text, VIEW, null)

function setup(now: () => number = () => 0) {
  const redis = fakeRedis(now)
  const held = heldModel()
  const store = () => redisStore(redis, memoryStore(now), now)
  const service = (overrides: Partial<Parameters<typeof createCopilotApp>[0]> = {}) =>
    createCopilotApp({ dataDir, bucket: null, model: held.model, allowedOrigins: [], ...VERSIONS, store: store(), now, flight, retry: { wait: async () => {} }, ...overrides })
  const counted = async () => dayReport('day', (await store().counts?.read(1))?.[0].counts ?? {})
  return { redis, ...held, service, counted, store }
}

describe('one recompute per key, in the co-pilot', () => {
  it('twenty people ask the same first question at once, on four copies: one answer is worked out', async () => {
    const { redis, generate, release, service, counted } = setup()
    const copies = [service(), service(), service(), service()]
    const events: QuestionEvent[] = []
    // One of the twenty is answered by a copy whose question events are kept here, to see how a waiter's is logged.
    const relay: Relay = {
      keep: async (id, event, attributes) => {
        events.push(event as unknown as QuestionEvent)
        return { id, event, attributes, queuedAt: 0 }
      },
      send: async () => true,
      sweep: async () => 0,
      start: () => {},
      stop: () => {},
    }
    const logged = service({ relay })
    const all = Array.from({ length: 20 }, (_, n) => (n === 19 ? logged : copies[n % copies.length]).request(ask(n + 1)))

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    // Everyone else is waiting: a moment later the model has still been called once.
    await realPause(30)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(redis.keys()).toEqual([`clps:lock:${KEY}`])
    release()

    const responses = await Promise.all(all)
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200))
    // One question worked out: the scripted stand-in's two calls (a lookup, then the answer).
    expect(generate).toHaveBeenCalledTimes(2)
    expect(responses.filter((response) => response.headers.get('x-cache') === 'miss')).toHaveLength(1)
    expect(responses.filter((response) => response.headers.get('x-cache') === 'hit')).toHaveLength(19)
    const texts = await Promise.all(responses.map(async (response) => ((await response.json()) as { reply: { text: string } }).reply.text))
    expect(new Set(texts).size).toBe(1)

    // The lock is gone and the answer is kept. The counters say who did what.
    expect(redis.keys()).toEqual([`clps:cache:${KEY}`])
    await realPause(5)
    expect(await counted()).toMatchObject({ cache: { copilot: { hits: 0, misses: 20 } }, flights: { copilot: { led: 1, waited: 19 } } })
    // A waiter's question is logged as answered from the cache: no model call was made for it.
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'answered', cached: true, lookups: ['Connecting Ridge, May 2027: month summary'] })
  })

  it('a streamed question that waits is told so in one step, then gets the kept answer', async () => {
    const { generate, release, service } = setup()
    const leader = service().request(ask(1, { stream: true }))
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const waiter = service().request(ask(2, { stream: true }))
    await realPause(20)
    release()

    const [first, second] = await Promise.all([leader, waiter].map(async (response) => (await response).text()))
    // The leader's stream has its lookup and its answer, as always.
    expect(first).toContain('event: step\ndata: {"title":"Connecting Ridge, May 2027: month summary"}')
    expect(first).not.toContain(WAITING_STEP)
    // The waiter's has one step saying it is waiting, then the same answer. No lookup of its own.
    expect(second.split('\n\n').filter(Boolean).map((block) => block.split('\n')[0])).toEqual(['event: step', 'event: reply'])
    expect(second).toContain(`event: step\ndata: {"title":"${WAITING_STEP}"}`)
    expect(second.split('event: reply\n')[1]).toBe(first.split('event: reply\n')[1])
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('only first questions share: a later question in a conversation is always worked out, and takes no lock', async () => {
    const { redis, generate, release, service } = setup()
    release()
    const later = { messages: [{ role: 'user', text: 'How sunny is it?' }, { role: 'assistant', text: 'Quite.' }, { role: 'user', text: 'And in June?' }], view: VIEW }
    const responses = await Promise.all([service().request(ask(1, { body: later })), service().request(ask(2, { body: later }))])
    expect(responses.map((response) => response.headers.get('x-cache'))).toEqual(['miss', 'miss'])
    expect(generate).toHaveBeenCalledTimes(4)
    expect(redis.calls.filter((call) => call === 'setNew')).toEqual([])
  })

  it('the holder died: a waiter takes over when the lock expires, and answers inside its own 25 s', async () => {
    let time = 0
    const { redis, generate, release, service, store, counted } = setup(() => time)
    // Another copy took the lock for this question and stopped.
    expect(await store().locks?.acquire(KEY, FLIGHT.lockMs)).not.toBeNull()
    release()
    time = 6000
    const waiting = service().request(ask(1))
    await realPause(20)
    expect(generate).not.toHaveBeenCalled()

    // 9 s later the dead copy's lock has expired (15 s), and this request has not yet waited its 10 s.
    time = 15_001
    const response = await waiting
    expect(response.status).toBe(200)
    expect(response.headers.get('x-cache')).toBe('miss')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(redis.keys()).toEqual([`clps:cache:${KEY}`])
    await realPause(5)
    expect((await counted()).flights).toEqual({ copilot: { 'took-over': 1 } })
  })

  it('a waiter that has waited its 10 s gives up and works the answer out itself', async () => {
    let time = 0
    const { generate, release, service, store, counted } = setup(() => time)
    await store().locks?.acquire(KEY, FLIGHT.lockMs)
    release()
    const waiting = service().request(ask(1))
    await realPause(20)
    expect(generate).not.toHaveBeenCalled()
    // Its 10 s are up, and the lock (15 s) is still held.
    time = 10_001
    const response = await waiting
    expect(response.status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
    await realPause(5)
    expect((await counted()).flights).toEqual({ copilot: { 'gave-up': 1 } })
  })

  it('with no Redis, every request works its answer out, as before', async () => {
    const held = heldModel()
    held.release()
    const app = createCopilotApp({ dataDir, bucket: null, model: held.model, allowedOrigins: [], ...VERSIONS, retry: { wait: async () => {} } })
    const responses = await Promise.all(Array.from({ length: 5 }, (_, n) => app.request(ask(n + 1))))
    expect(responses.map((response) => response.headers.get('x-cache'))).toEqual(Array(5).fill('miss'))
    // Five questions, two model calls each.
    expect(held.generate).toHaveBeenCalledTimes(10)
  })

  it('with Redis away, nobody waits: every request works its answer out from the start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { redis, generate, release, service, counted } = setup()
    redis.down = true
    release()
    const app = service()
    const responses = await Promise.all([app.request(ask(1)), app.request(ask(2)), app.request(ask(3))])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(generate.mock.calls.length).toBeGreaterThanOrEqual(2)
    redis.down = false
    expect((await counted()).flights).toEqual({})
    vi.restoreAllMocks()
  })

  it('a failed answer is not shared: the lock comes free and the next request tries for itself', async () => {
    const { redis, service, counted } = setup()
    const failing: Model = { generate: vi.fn(async () => Promise.reject(apiError(500))) }
    const responses = await Promise.all([service({ model: failing }).request(ask(1)), service({ model: failing }).request(ask(2))])
    expect(responses.map((response) => response.status)).toEqual([502, 502])
    expect(redis.keys()).toEqual([])
    await realPause(5)
    expect((await counted()).flights).toEqual({ copilot: { led: 1, 'took-over': 1 } })
  })
})

describe('the answer cache on a Redis Cluster', () => {
  /** A stand-in for the cluster client: a map, and a switch to fail it. */
  function fakeCluster() {
    const values = new Map<string, string>()
    const cluster = {
      down: false,
      values,
      get: async (key: string) => {
        if (cluster.down) throw new Error('CLUSTERDOWN')
        return values.get(key) ?? null
      },
      setEx: async (key: string, _ttlSeconds: number, value: string) => {
        if (cluster.down) throw new Error('CLUSTERDOWN')
        values.set(key, value)
      },
    }
    return cluster
  }

  it('keeps answers on the cluster and everything else on the ordinary instance', async () => {
    const { redis, release, generate, store } = setup()
    release()
    const cluster = fakeCluster()
    const ordinary = store()
    const app = createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], ...VERSIONS, store: ordinary, answers: clusterCache(cluster, ordinary.cache, ordinary.counts), clusterState: () => 'ready', flight })
    expect(((await (await app.request(`${ORIGIN}/api/chat/status`)).json()) as { answers: string }).answers).toBe('cluster')
    // The status asked the ordinary instance one small read to check it answers; the questions start from here.
    redis.calls.length = 0
    expect((await app.request(ask(1))).headers.get('x-cache')).toBe('miss')
    expect((await app.request(ask(2))).headers.get('x-cache')).toBe('hit')
    expect([...cluster.values.keys()]).toEqual([`clps:cache:${KEY}`])
    // The ordinary instance holds no answer: it was asked for limits, the lock and the counters only.
    expect(redis.keys()).toEqual([])
    expect(new Set(redis.calls)).toEqual(new Set(['slidingWindow', 'setNew', 'deleteIf', 'increment']))
    expect(generate).not.toHaveBeenCalled()
  })

  it('a cluster that fails falls back to the ordinary instance, then to a miss, and never fails a question', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { redis, store } = setup()
    const cluster = fakeCluster()
    const ordinary = store()
    const answers = clusterCache(cluster, ordinary.cache, ordinary.counts)
    const app = createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], ...VERSIONS, store: ordinary, answers, flight })

    cluster.down = true
    expect((await app.request(ask(1))).headers.get('x-cache')).toBe('miss')
    // Kept on the ordinary instance instead, and found there while the cluster stays down.
    expect(redis.keys()).toEqual([`clps:cache:${KEY}`])
    expect((await app.request(ask(2))).headers.get('x-cache')).toBe('hit')
    expect(warn).toHaveBeenCalledTimes(1)

    // The cluster is back and empty: a miss there is a miss. The answer is worked out and kept on the cluster.
    cluster.down = false
    expect((await app.request(ask(3))).headers.get('x-cache')).toBe('miss')
    expect([...cluster.values.keys()]).toEqual([`clps:cache:${KEY}`])

    // Both away: this copy's memory, and a question still gets its answer.
    cluster.down = true
    redis.down = true
    expect((await app.request(ask(4))).status).toBe(200)
    warn.mockRestore()
  })
})
