import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../events-worker/app'
import { type EventSink, pushBody, type PublishResult } from '../shared/events'
import type { Log } from '../shared/log'
import { memoryStats } from '../shared/stats'
import { createCopilotApp } from './app'
import { memoryOutbox, type OutboxRedis, outboxRelay, type Relay, redisOutbox } from './outbox'
import { apiError } from './standIns'

const quiet: Log = { info: () => {}, warn: () => {}, error: () => {} }
const SECOND = 1000
const event = (id: string) => ({ kind: 'copilot_question', id, at: '2026-11-12T11:59:00.000Z', question: 'q', site: 's', month: '2027-05', lookups: [], cached: false, ms: 5, outcome: 'answered' })

/** A queue that can be told to fail, in front of a real worker (in memory), so "counted once" is checked end to end. */
function queueAndWorker() {
  const stats = memoryStats()
  const worker = createWorker({ stats, callers: null, pushIdentity: null, checkIdentities: [], log: quiet, version: 't', dataVersion: null, revision: null })
  const state = { up: true, loseTheAnswer: false, published: 0, refuse: false }
  let messageId = 0
  const sink: EventSink = {
    async publish(published, attributes = {}): Promise<PublishResult> {
      if (state.refuse) return 'refused'
      if (!state.up) return 'retry'
      state.published += 1
      // Each publish is a new message to the queue, with a new message id, as on Pub/Sub.
      const response = await worker.request('https://worker.example/push', { method: 'POST', body: pushBody(published, attributes, String(++messageId)) })
      if (!response.ok) return 'retry'
      // The queue took it, but the publisher never heard: the worst case for counting twice.
      return state.loseTheAnswer ? 'retry' : 'sent'
    },
  }
  const questions = async () => (await stats.read('2026-11-12')).counts.questions
  return { sink, state, questions }
}

afterEach(() => vi.restoreAllMocks())

describe('the outbox relay', () => {
  it('keeps an event, publishes it, and removes it once the queue has it', async () => {
    const { sink, questions } = queueAndWorker()
    const outbox = memoryOutbox()
    const relay = outboxRelay(sink, outbox, () => 0)
    const entry = await relay.keep('a', event('a'), { kind: 'copilot_question' })
    // Kept before anything is published.
    expect(await outbox.waiting()).toHaveLength(1)
    expect(await questions()).toBe(0)
    expect(await relay.send(entry)).toBe(true)
    expect(await outbox.waiting()).toHaveLength(0)
    expect(await questions()).toBe(1)
  })

  it('does not lose an event the queue would not take: it waits, and goes out when the queue is back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sink, state, questions } = queueAndWorker()
    const clock = { ms: 0 }
    const outbox = memoryOutbox()
    const relay = outboxRelay(sink, outbox, () => clock.ms)
    state.up = false
    for (const id of ['a', 'b', 'c']) expect(await relay.send(await relay.keep(id, event(id), {}))).toBe(false)
    expect(await outbox.waiting()).toHaveLength(3)

    // A sweep straight away leaves fresh events to the requests that wrote them.
    expect(await relay.sweep()).toBe(0)
    // Later, with the queue still down, it tries one, fails, and backs off.
    clock.ms = 20 * SECOND
    expect(await relay.sweep()).toBe(0)
    expect(await outbox.waiting()).toHaveLength(3)

    // The queue is back, but the relay is still waiting out its delay...
    state.up = true
    clock.ms = 30 * SECOND
    expect(await relay.sweep()).toBe(0)
    // ...and then everything goes out, each event once.
    clock.ms = 61 * SECOND
    expect(await relay.sweep()).toBe(3)
    expect(await outbox.waiting()).toHaveLength(0)
    expect(await questions()).toBe(3)
    expect(state.published).toBe(3)
  })

  it('waits longer after each sweep that fails, up to five minutes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sink, state } = queueAndWorker()
    const clock = { ms: 0 }
    const relay = outboxRelay(sink, memoryOutbox(), () => clock.ms)
    state.up = false
    await relay.keep('a', event('a'), {})
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      // Step forward a second at a time until the relay tries again.
      const before = warn.mock.calls.length
      const from = clock.ms
      while (warn.mock.calls.length === before) {
        clock.ms += SECOND
        await relay.sweep()
      }
      waits.push((clock.ms - from) / SECOND)
    }
    expect(waits).toEqual([15, 40, 80, 160, 300, 300])
  })

  it('never counts an event twice, even when a publish succeeded and the relay did not hear', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sink, state, questions } = queueAndWorker()
    const clock = { ms: 0 }
    const outbox = memoryOutbox()
    const relay = outboxRelay(sink, outbox, () => clock.ms)
    state.loseTheAnswer = true
    expect(await relay.send(await relay.keep('a', event('a'), {}))).toBe(false)
    // The queue has it, the worker counted it, and the outbox still holds it.
    expect(await questions()).toBe(1)
    expect(await outbox.waiting()).toHaveLength(1)

    // So the relay sends it again, twice more. The worker refuses the copies by the event's id.
    clock.ms = 20 * SECOND
    await relay.sweep()
    state.loseTheAnswer = false
    clock.ms = 10 * 60 * SECOND
    expect(await relay.sweep()).toBe(1)
    expect(state.published).toBe(3)
    expect(await questions()).toBe(1)
    expect(await outbox.waiting()).toHaveLength(0)
  })

  it('drops an event the queue refuses for good, and one that has waited three days, and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sink, state } = queueAndWorker()
    const clock = { ms: 0 }
    const outbox = memoryOutbox()
    const relay = outboxRelay(sink, outbox, () => clock.ms)
    state.refuse = true
    expect(await relay.send(await relay.keep('a', event('a'), {}))).toBe(true)
    expect(await outbox.waiting()).toHaveLength(0)
    expect(error).toHaveBeenCalledTimes(1)

    state.refuse = false
    state.up = false
    await relay.keep('b', event('b'), {})
    clock.ms = 3 * 24 * 60 * 60 * SECOND + 1
    await relay.sweep()
    expect(await outbox.waiting()).toHaveLength(0)
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('sends everything when the copy is told to stop, fresh events included', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sink, questions } = queueAndWorker()
    const relay = outboxRelay(sink, memoryOutbox(), () => 0)
    await relay.keep('a', event('a'), {})
    await relay.keep('b', event('b'), {})
    expect(await relay.sweep()).toBe(0)
    expect(await relay.sweep({ everything: true })).toBe(2)
    expect(await questions()).toBe(2)
  })
})

describe('a co-pilot question and the outbox', () => {
  const ORIGIN = 'https://clps-web.example.run.app'
  // The model fails, which is still a question worth an event, and needs no site data.
  const site = (relay: Relay) =>
    createCopilotApp({ dataDir: '/nonexistent', bucket: null, model: { generate: async () => Promise.reject(apiError(500)) }, allowedOrigins: [], relay, version: 'test', codeVersion: 'test', dataVersion: 'test', revision: null, retry: { wait: async () => {} } })
  const ask = (stream = false) =>
    new Request(`${ORIGIN}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7', ...(stream ? { accept: 'text/event-stream' } : {}) },
      body: JSON.stringify({ messages: [{ role: 'user', text: 'How sunny is it?' }], view: '#a=connecting-ridge@2027-05' }),
    })

  it('keeps the event when the queue is down, answers the visitor all the same, and sends it once the queue is back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sink, state } = queueAndWorker()
    const outbox = memoryOutbox()
    const relay = outboxRelay(sink, outbox)
    state.up = false
    const app = site(relay)
    // The visitor gets the same answer they would have got: the queue's trouble is not theirs.
    expect((await app.request(ask())).status).toBe(502)
    expect((await app.request(ask())).status).toBe(502)
    expect(await outbox.waiting()).toHaveLength(2)
    expect(state.published).toBe(0)

    state.up = true
    expect(await relay.sweep({ everything: true })).toBe(2)
    expect(await outbox.waiting()).toHaveLength(0)
    expect(state.published).toBe(2)
  })

  it('writes the event to the outbox before the answer leaves, and does not hold the answer for the publish', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const order: string[] = []
    const inner = outboxRelay({ publish: () => 'sent' }, memoryOutbox())
    const relay: Relay = {
      ...inner,
      async keep(id, event, attributes) {
        await new Promise((done) => setTimeout(done, 20))
        order.push('kept in the outbox')
        return inner.keep(id, event, attributes)
      },
      async send(entry) {
        // A publish takes about 50 ms on the live site; the answer must not wait for it.
        await new Promise((done) => setTimeout(done, 20))
        order.push('published')
        return inner.send(entry)
      },
    }
    const response = await site(relay).request(ask(true))
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader?.read()) {
      if (decoder.decode(chunk.value).includes('event: error')) order.push('answer sent')
    }
    expect(order).toEqual(['kept in the outbox', 'answer sent', 'published'])
  })
})

/** Redis as the outbox uses it: one hash and one lock. `down` makes every command fail. */
function fakeRedis() {
  const hashes = new Map<string, Map<string, string>>()
  const locks = new Map<string, number>()
  const state = { down: false, now: 0 }
  const check = () => (state.down ? Promise.reject(new Error('Redis is down')) : Promise.resolve())
  const redis: OutboxRedis = {
    async hSet(key, field, value) {
      await check()
      hashes.set(key, (hashes.get(key) ?? new Map()).set(field, value))
    },
    async hGetAll(key) {
      await check()
      return Object.fromEntries(hashes.get(key) ?? [])
    },
    async hDel(key, fields) {
      await check()
      for (const field of fields) hashes.get(key)?.delete(field)
    },
    async setNew(key, _value, ttlMs) {
      await check()
      if ((locks.get(key) ?? 0) > state.now) return false
      locks.set(key, state.now + ttlMs)
      return true
    },
  }
  return { redis, state, stored: () => [...(hashes.get('clps:outbox:events')?.keys() ?? [])] }
}

describe('the outbox on Redis', () => {
  it('is shared: an event one copy left behind is sent by another', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { redis, stored } = fakeRedis()
    const { sink, state, questions } = queueAndWorker()
    const clock = { ms: 0 }
    const first = outboxRelay(sink, redisOutbox(redis), () => clock.ms)
    state.up = false
    await first.send(await first.keep('a', event('a'), { traceparent: '00-105445aa7843bc8bf206b12000100000-00f067aa0ba902b7-01' }))
    expect(stored()).toEqual(['a'])
    // The first copy is gone (stopped, or frozen without CPU). A second copy's timer finds the event.
    state.up = true
    clock.ms = 20 * SECOND
    const second = outboxRelay(sink, redisOutbox(redis), () => clock.ms)
    expect(await second.sweep()).toBe(1)
    expect(stored()).toEqual([])
    expect(await questions()).toBe(1)
  })

  it('lets one copy sweep at a time', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { redis, state: redisState } = fakeRedis()
    const { sink, state } = queueAndWorker()
    const clock = { ms: 0 }
    const a = outboxRelay(sink, redisOutbox(redis), () => clock.ms)
    const b = outboxRelay(sink, redisOutbox(redis), () => clock.ms)
    await a.keep('a', event('a'), {})
    clock.ms = 20 * SECOND
    redisState.now = clock.ms
    const sent = await Promise.all([a.sweep(), b.sweep()])
    expect(sent.toSorted()).toEqual([0, 1])
    expect(state.published).toBe(1)
  })

  it('holds the event in memory when Redis is away, and still publishes it', async () => {
    const { redis, state: redisState, stored } = fakeRedis()
    const { sink, questions } = queueAndWorker()
    const outbox = redisOutbox(redis)
    const relay = outboxRelay(sink, outbox, () => 0)
    redisState.down = true
    const entry = await relay.keep('a', event('a'), {})
    expect(stored()).toEqual([])
    expect(await outbox.waiting()).toHaveLength(1)
    expect(await relay.send(entry)).toBe(true)
    expect(await outbox.waiting()).toHaveLength(0)
    expect(await questions()).toBe(1)
  })

  it('skips an entry it cannot read rather than stopping', async () => {
    const { redis } = fakeRedis()
    await redis.hSet('clps:outbox:events', 'broken', 'not json')
    await redis.hSet('clps:outbox:events', 'ok', JSON.stringify({ id: 'ok', event: event('ok'), attributes: {}, queuedAt: 0 }))
    expect((await redisOutbox(redis).waiting()).map((entry) => entry.id)).toEqual(['ok'])
  })
})
