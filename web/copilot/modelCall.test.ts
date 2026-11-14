import { APIConnectionError, APIConnectionTimeoutError, type APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { memoryBreaker } from './breaker'
import type { Model, ModelMessage, ModelRequest } from './model'
import { backoffMs, type CallReport, callModel, failureOf, modelGuard, RETRY, retryAfterMs } from './modelCall'
import { apiError, claudeMessage, fallbackBlock, refusal, textBlock } from './standIns'

/** A clock that only moves when the code under test waits, and a record of every wait. */
function fakeClock(start = 1_000_000) {
  const clock = { ms: start, waits: [] as number[] }
  return {
    clock,
    now: () => clock.ms,
    wait: async (ms: number) => {
      clock.waits.push(ms)
      clock.ms += ms
    },
  }
}

/** The same "random" numbers every run, so the jitter can be checked exactly. */
function seeded(...values: number[]) {
  let i = 0
  return () => values[i++ % values.length]
}

const REQUEST: ModelRequest = { messages: [{ role: 'user', content: 'Hello' }], max_tokens: 64 }
const ok = () => claudeMessage({ content: [textBlock('Hello.')] })
/** The SDK's typed error for an HTTP status, with its headers. */
const status = (code: number, headers: Record<string, string> = {}) => apiError(code, headers)

/**
 * A model that answers each call from the list in turn: a message is returned, an SDK error is
 * thrown, and `null` throws the SDK's timeout error, as a timed-out or dropped connection does.
 */
function answering(...replies: (ModelMessage | APIError | null)[]) {
  return vi.fn<Model['generate']>(async () => {
    const next = replies.shift()
    if (next === undefined || next === null) throw new APIConnectionTimeoutError()
    if (next instanceof Error) throw next
    return next
  })
}

describe('retries with growing delays and full jitter', () => {
  it('waits a random time up to 0.5 s, then up to 1 s: full jitter, capped', () => {
    expect([0, 0.5, 0.999].map((r) => backoffMs(1, RETRY, () => r))).toEqual([0, 250, 499])
    expect([0, 0.5, 0.999].map((r) => backoffMs(2, RETRY, () => r))).toEqual([0, 500, 999])
    // The ceiling doubles each time up to 4 s, and goes no higher.
    expect(backoffMs(4, RETRY, () => 0.999)).toBe(3996)
    expect(backoffMs(10, RETRY, () => 0.999)).toBe(3996)
  })

  it('tries three times in all on 503, 429 and timeouts, waiting the jittered times between', async () => {
    const { clock, now, wait } = fakeClock()
    const generate = answering(status(503), null, ok())
    const guard = modelGuard({ now, wait, random: seeded(0.2, 0.7) })
    const outcome = await callModel({ generate }, REQUEST, guard, { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'model call' })
    expect(outcome.ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(3)
    // 0.2 × 500 ms, then 0.7 × 1000 ms.
    expect(clock.waits).toEqual([100, 700])
  })

  it('gives up after three tries and says why, without a fourth', async () => {
    const { clock, now, wait } = fakeClock()
    const generate = answering(status(503), status(503), status(503), ok())
    const outcome = await callModel({ generate }, REQUEST, modelGuard({ now, wait, random: seeded(0.5) }), { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    expect(outcome).toEqual({ ok: false, reason: 'failed', status: 503, retryAfterMs: null })
    expect(generate).toHaveBeenCalledTimes(3)
    expect(clock.waits).toEqual([250, 500])
  })

  it('never retries a 400: the request is wrong and would fail the same way', async () => {
    const { clock, now, wait } = fakeClock()
    const generate = answering(status(400), ok())
    const breaker = memoryBreaker(now)
    const outcome = await callModel({ generate }, REQUEST, modelGuard({ now, wait, breaker }), { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    expect(outcome).toMatchObject({ ok: false, reason: 'failed', status: 400 })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(clock.waits).toEqual([])
    // Nor does it count against the model: the model answered.
    for (let i = 0; i < 6; i++) await callModel({ generate: answering(status(400)) }, REQUEST, modelGuard({ now, wait, breaker }), { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    expect((await breaker.peek()).state).toBe('closed')
  })

  it('waits at least as long as the model asks in its Retry-After, and passes the wait on', async () => {
    const { clock, now, wait } = fakeClock()
    const generate = answering(status(429, { 'retry-after': '3' }), status(429, { 'retry-after': '4' }), status(429, { 'retry-after': '5' }))
    const outcome = await callModel({ generate }, REQUEST, modelGuard({ now, wait, random: seeded(0.9) }), { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    expect(clock.waits).toEqual([3000, 4000])
    expect(outcome).toEqual({ ok: false, reason: 'busy', status: 429, retryAfterMs: 5000 })
  })

  it('never retries past the deadline: a try starts only with 2 s left after its wait', async () => {
    const { clock, now, wait } = fakeClock()
    const generate = answering(status(503), status(503), ok())
    // 2.4 s left: a wait of up to 0.5 s still leaves 2 s for the second try; then nothing is left for a third.
    const outcome = await callModel({ generate }, REQUEST, modelGuard({ now, wait, random: seeded(0.8, 0.8) }), { deadline: now() + 2400, callTimeoutMs: 10_000, name: 'm' })
    expect(outcome.ok).toBe(false)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(clock.waits).toEqual([400])
    // And a model's Retry-After longer than the time left is not waited for at all.
    const late = answering(status(429, { 'retry-after': '30' }), ok())
    const { clock: other, now: otherNow, wait: otherWait } = fakeClock()
    expect((await callModel({ generate: late }, REQUEST, modelGuard({ now: otherNow, wait: otherWait }), { deadline: otherNow() + 25_000, callTimeoutMs: 10_000, name: 'm' })).ok).toBe(false)
    expect(other.waits).toEqual([])
  })

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-11-12T12:00:00Z')
    expect(retryAfterMs('7', now)).toBe(7000)
    expect(retryAfterMs('Thu, 12 Nov 2026 12:00:05 GMT', now)).toBe(5000)
    expect(retryAfterMs('soon', now)).toBeNull()
    expect(retryAfterMs(null, now)).toBeNull()
  })
})

describe('the model call and the circuit breaker together', () => {
  it('opens after 5 failed calls; then no call reaches the model, and the visitor is told how long to wait', async () => {
    const { now, wait, clock } = fakeClock()
    const generate = vi.fn<Model["generate"]>(async () => { throw status(503) })
    const guard = modelGuard({ now, wait, random: seeded(0) })
    const call = () => callModel({ generate }, REQUEST, guard, { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    for (let i = 0; i < 5; i++) expect((await call()).ok).toBe(false)
    // Three tries for each of the five failed calls.
    expect(generate).toHaveBeenCalledTimes(15)

    generate.mockClear()
    expect(await call()).toEqual({ ok: false, reason: 'circuit-open', status: null, retryAfterMs: 30_000 })
    expect(generate).not.toHaveBeenCalled()

    // After 30 s one trial goes through, once, with no retry; the model is back, so the breaker closes.
    clock.ms += 30_000
    generate.mockImplementation(async () => ok())
    expect((await call()).ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
    expect((await guard.breaker.peek()).state).toBe('closed')
  })

  it('does not retry the trial: one failure and it opens again', async () => {
    const { now, wait, clock } = fakeClock()
    const generate = vi.fn<Model["generate"]>(async () => { throw status(503) })
    const guard = modelGuard({ now, wait })
    const call = () => callModel({ generate }, REQUEST, guard, { deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })
    for (let i = 0; i < 5; i++) await call()
    clock.ms += 30_000
    generate.mockClear()
    await call()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(await guard.breaker.peek()).toEqual({ state: 'open', retryAfterMs: 30_000 })
  })
})

describe("Claude's errors, as the retries and the breaker see them", () => {
  const options = (now: () => number) => ({ deadline: now() + 25_000, callTimeoutMs: 10_000, name: 'm' })

  it('reads the status and Retry-After from the SDK error, and nothing from errors without a status', () => {
    const now = Date.parse('2026-11-12T12:00:00Z')
    expect(failureOf(apiError(429, { 'retry-after': '12' }), now)).toEqual({ status: 429, retryAfterMs: 12_000 })
    expect(failureOf(apiError(529), now)).toEqual({ status: 529, retryAfterMs: null })
    expect(failureOf(new APIConnectionTimeoutError(), now)).toEqual({ status: null, retryAfterMs: null })
    expect(failureOf(new APIConnectionError({ message: 'reset' }), now)).toEqual({ status: null, retryAfterMs: null })
    expect(failureOf(new APIUserAbortError(), now)).toEqual({ status: null, retryAfterMs: null })
    expect(failureOf(new Error('anything else'), now)).toEqual({ status: null, retryAfterMs: null })
  })

  it('retries 529 overloaded and says busy if it stays so; it counts against the model', async () => {
    const { now, wait } = fakeClock()
    const breaker = memoryBreaker(now)
    const generate = answering(status(529), status(529), status(529))
    expect(await callModel({ generate }, REQUEST, modelGuard({ now, wait, breaker, random: seeded(0) }), options(now))).toEqual({ ok: false, reason: 'busy', status: 529, retryAfterMs: null })
    expect(generate).toHaveBeenCalledTimes(3)
    // Five such calls open the breaker, as five 503s would.
    for (let i = 0; i < 4; i++) await callModel({ generate: answering(status(529), status(529), status(529)) }, REQUEST, modelGuard({ now, wait, breaker, random: seeded(0) }), options(now))
    expect((await breaker.peek()).state).toBe('open')
  })

  it('retries 5xx, 408, 409 and timeouts, the SDK raising any of them', async () => {
    const { now, wait } = fakeClock()
    for (const first of [status(500), status(502), status(504), status(408), status(409), null]) {
      const generate = answering(first, ok())
      expect((await callModel({ generate }, REQUEST, modelGuard({ now, wait }), options(now))).ok).toBe(true)
      expect(generate).toHaveBeenCalledTimes(2)
    }
  })

  it('never retries a wrong key or a forbidden call, and does not hold either against the model', async () => {
    const { now, wait } = fakeClock()
    const breaker = memoryBreaker(now)
    for (const code of [401, 403, 404, 413]) {
      const generate = answering(status(code), ok())
      expect(await callModel({ generate }, REQUEST, modelGuard({ now, wait, breaker }), options(now))).toEqual({ ok: false, reason: 'failed', status: code, retryAfterMs: null })
      expect(generate).toHaveBeenCalledTimes(1)
    }
    for (let i = 0; i < 6; i++) await callModel({ generate: answering(status(401)) }, REQUEST, modelGuard({ now, wait, breaker }), options(now))
    expect((await breaker.peek()).state).toBe('closed')
  })

  it('takes a refusal as an answer: no retry, and the breaker hears the model is up', async () => {
    const { now, wait, clock } = fakeClock()
    const breaker = memoryBreaker(now)
    const guard = modelGuard({ now, wait, breaker, random: seeded(0) })
    // Open the breaker, then let its trial be a refusal: a refusal closes it, as any answer does.
    for (let i = 0; i < 5; i++) await callModel({ generate: answering(status(503), status(503), status(503)) }, REQUEST, guard, options(now))
    clock.ms += 30_000
    const generate = answering(refusal('cyber'))
    const outcome = await callModel({ generate }, REQUEST, guard, options(now))
    expect(outcome.ok && outcome.message.stop_reason).toBe('refusal')
    expect(generate).toHaveBeenCalledTimes(1)
    expect((await breaker.peek()).state).toBe('closed')
  })

  it('reports every try: time, tokens, speed, stop reason, a fallback and a refusal', async () => {
    const { now, wait } = fakeClock()
    const reports: CallReport[] = []
    const answered = claudeMessage({
      model: 'claude-opus-4-8',
      content: [fallbackBlock('claude-opus-5-5', 'claude-opus-4-8'), textBlock('Done.')],
      usage: {
        input_tokens: 1200,
        output_tokens: 80,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 0,
        speed: 'fast',
        iterations: [{ type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1200, output_tokens: 80, cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 }],
      },
    })
    await callModel({ generate: answering(status(529), answered, refusal('bio')) }, REQUEST, modelGuard({ now, wait, random: seeded(0), report: (call) => reports.push(call) }), options(now))
    await callModel({ generate: answering(refusal('bio')) }, REQUEST, modelGuard({ now, wait, report: (call) => reports.push(call) }), options(now))
    expect(reports).toHaveLength(3)
    expect(reports[0]).toMatchObject({ name: 'm', status: 529, stopReason: null, fallback: false })
    expect(reports[1]).toMatchObject({ name: 'm, try 2', status: null, stopReason: 'end_turn', model: 'claude-opus-4-8', speed: 'fast', inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900, fallback: true, refusal: null })
    expect(reports[2]).toMatchObject({ stopReason: 'refusal', refusal: 'bio' })
  })
})
