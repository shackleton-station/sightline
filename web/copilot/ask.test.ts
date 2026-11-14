import { describe, expect, it, vi } from 'vitest'
import { ASK_MAX_TOKENS } from './ask'
import { LIMITS } from './limits'
import type { Model } from './model'
import { apiError, claudeMessage, refusal, textBlock } from './standIns'
import { ORIGIN, PROGRAMS } from './testing'

/** A model that answers with `answer` as its structured output, or fails with `status`. */
function modelReplying(answer: unknown, status = 200) {
  const generate = vi.fn<Model['generate']>(async () => {
    if (status !== 200) throw apiError(status)
    return claudeMessage({ content: [{ type: 'thinking', thinking: '', signature: 'sig' }, textBlock(JSON.stringify(answer))] })
  })
  return { generate } satisfies Model
}

function ask(body: unknown, init: { origin?: string | null; method?: string; visitor?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set('x-forwarded-for', `10.9.9.9, ${init.visitor ?? '203.0.113.7'}`)
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN)
  return new Request(`${ORIGIN}/api/ask`, {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? undefined : JSON.stringify(body),
  })
}

// Moved here from server/app.test.ts with the code.
describe.each(PROGRAMS)('typed questions, answered by $name', (program) => {
  const app = (overrides: Parameters<typeof program.site>[0] = {}) => program.site({ model: modelReplying({}), ...overrides })

  it('returns checked settings from the model', async () => {
    const model = modelReplying({ sites: ['connecting-ridge', 'not-a-site'], month: '2027-03', missionDays: 14 })
    const response = await app({ model }).request(ask({ question: 'two weeks at Connecting Ridge in March 2027' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      result: { sites: ['connecting-ridge'], month: '2027-03', requirements: { missionDays: 14 } },
    })
    const [request] = model.generate.mock.calls[0]
    // A structured output, not a forced tool call and not a prefilled answer: the last message is the question.
    expect(request.format?.type).toBe('json_schema')
    expect(request.format?.schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(request.tools).toBeUndefined()
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].role).toBe('user')
    expect(request.max_tokens).toBe(ASK_MAX_TOKENS)
    // The list of sites comes from the site data the program reads, not a copy bundled when it was built.
    expect(String(request.messages[0].content)).toContain('connecting-ridge: Connecting Ridge')
  })

  it('reads the answer from the text block, after any thinking blocks', async () => {
    const generate = vi.fn<Model['generate']>(async () => claudeMessage({ content: [{ type: 'thinking', thinking: '', signature: 's' }, textBlock('{"month":"2027-03"}')] }))
    expect((await app({ model: { generate } }).request(ask({ question: 'March 2027' }))).status).toBe(200)
  })

  it('says the question was declined when the model refuses it, and does not try again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const generate = vi.fn<Model['generate']>(async () => refusal('general_harms'))
    const response = await app({ model: { generate } }).request(ask({ question: 'something it declines' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'declined' })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('general_harms')
    warn.mockRestore()
  })

  it('treats an answer cut off at max_tokens as a failure, not as settings', async () => {
    const generate = vi.fn<Model['generate']>(async () => claudeMessage({ content: [textBlock('{"month":"2027-')], stop_reason: 'max_tokens' }))
    expect((await app({ model: { generate } }).request(ask({ question: 'March 2027' }))).status).toBe(502)
  })

  it('refuses other sites, missing origins and other methods', async () => {
    const model = modelReplying({})
    const site = app({ model })
    expect((await site.request(ask({ question: 'hi' }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await site.request(ask({ question: 'hi' }, { origin: null }))).status).toBe(403)
    expect((await site.request(ask(null, { method: 'GET' }))).status).toBe(405)
    expect(model.generate).not.toHaveBeenCalled()
  })

  it('accepts its own pages behind a proxy that ends TLS, and extra origins for local dev', async () => {
    const behindProxy = ask({ question: 'a one-week mission' })
    const plainHttp = new Request(behindProxy.url.replace('https://', 'http://'), behindProxy)
    expect((await app({ model: modelReplying({ missionDays: 7 }) }).request(plainHttp)).status).toBe(200)

    const local = ask({ question: 'a one-week mission' }, { origin: 'http://localhost:5173' })
    const site = app({ model: modelReplying({ missionDays: 7 }), allowedOrigins: ['http://localhost:5173'] })
    expect((await site.request(local)).status).toBe(200)
  })

  it('allows 10 questions a minute per visitor, and says when the next one may be asked', async () => {
    let time = 0
    const site = app({ model: modelReplying({ missionDays: 7 }), now: () => time })
    for (let i = 0; i < 10; i++) {
      time = i * 1000
      expect((await site.request(ask({ question: 'hi' }))).status).toBe(200)
    }
    time = 20_000
    const refused = await site.request(ask({ question: 'hi' }))
    expect(refused.status).toBe(429)
    // The first of the ten was at 0 s and leaves the minute at 60 s: 40 s from now.
    expect(refused.headers.get('retry-after')).toBe('40')
    expect(await refused.json()).toEqual({ error: 'busy', retryAfterSeconds: 40 })
    expect((await site.request(ask({ question: 'hi' }, { visitor: '198.51.100.2' }))).status).toBe(200)
    time = 61_000
    expect((await site.request(ask({ question: 'hi' }))).status).toBe(200)
  })

  it('counts the visitor, not the load balancer, when requests come through it', async () => {
    const balancer = '34.128.184.151'
    const through = (visitor: string, typed = '') => {
      const request = ask({ question: 'hi' })
      request.headers.set('x-forwarded-for', `${typed}${visitor}, ${balancer}`)
      return request
    }
    const site = app({ model: modelReplying({ missionDays: 7 }), now: () => 0, trustedProxies: [balancer] })
    for (let i = 0; i < 10; i++) expect((await site.request(through('203.0.113.7'))).status).toBe(200)
    expect((await site.request(through('203.0.113.7'))).status).toBe(429)
    // Another visitor behind the same load balancer has their own allowance.
    expect((await site.request(through('198.51.100.2'))).status).toBe(200)
    // Typing a made-up address, even the load balancer's, doesn't buy a new one.
    expect((await site.request(through('203.0.113.7', '192.0.2.1, '))).status).toBe(429)
    expect((await site.request(through('203.0.113.7', `${balancer}, `))).status).toBe(429)
    // Straight to Cloud Run, the last entry is still the visitor.
    expect((await site.request(ask({ question: 'hi' }, { visitor: '203.0.113.7' }))).status).toBe(429)
  })

  it('allows 30 questions a minute overall', async () => {
    const site = app({ model: modelReplying({ missionDays: 7 }), now: () => 0 })
    for (let i = 0; i < 30; i++) {
      expect((await site.request(ask({ question: 'hi' }, { visitor: `198.51.100.${i}` }))).status).toBe(200)
    }
    const refused = await site.request(ask({ question: 'hi' }, { visitor: '198.51.100.99' }))
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('60')
  })

  it('rejects empty, too long and malformed questions', async () => {
    const model = modelReplying({})
    const site = app({ model })
    for (const body of [{ question: '   ' }, { question: 'x'.repeat(401) }, { q: 'hi' }, 'hi']) {
      expect((await site.request(ask(body))).status).toBe(400)
    }
    expect(model.generate).not.toHaveBeenCalled()
  })

  it('says so when no model is configured, with no Retry-After: waiting will not help', async () => {
    const response = await app({ model: null }).request(ask({ question: 'hi' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeNull()
  })

  it('reports a used-up model quota (429) or an overloaded model (529) as busy with a wait, and other failures as upstream, after retrying', async () => {
    const overloaded = modelReplying({}, 529)
    expect((await app({ model: overloaded }).request(ask({ question: 'hi' }))).status).toBe(429)
    expect(overloaded.generate).toHaveBeenCalledTimes(3)
    // A wrong key is not retried and is not "busy".
    const wrongKey = modelReplying({}, 401)
    expect((await app({ model: wrongKey }).request(ask({ question: 'hi' }))).status).toBe(502)
    expect(wrongKey.generate).toHaveBeenCalledTimes(1)
    const busyModel = modelReplying({}, 429)
    const busy = await app({ model: busyModel }).request(ask({ question: 'hi' }))
    expect(busy.status).toBe(429)
    expect(busy.headers.get('retry-after')).toBe('10')
    expect(await busy.json()).toEqual({ error: 'busy', retryAfterSeconds: 10 })
    expect(busyModel.generate).toHaveBeenCalledTimes(3)
    expect((await app({ model: modelReplying({}, 500) }).request(ask({ question: 'hi' }))).status).toBe(502)
    const broken: Model = { generate: () => Promise.reject(new Error('network')) }
    expect((await app({ model: broken }).request(ask({ question: 'hi' }))).status).toBe(502)
  })

  it('has a daily ceiling per visitor, and says to wait until the day is over', async () => {
    let time = 0
    const site = app({ model: modelReplying({ missionDays: 7 }), now: () => time })
    // Spread over the day, so only the daily ceiling can refuse.
    for (let i = 0; i < LIMITS.ask.eachDay; i++) {
      time = i * 2 * 60_000
      expect((await site.request(ask({ question: 'hi' }))).status, `question ${i + 1}`).toBe(200)
    }
    const refused = await site.request(ask({ question: 'hi' }))
    expect(refused.status).toBe(429)
    // Until the first of the day's questions, at 0, leaves its 24 hours.
    const wait = Math.ceil((24 * 60 * 60_000 - time) / 1000)
    expect(refused.headers.get('retry-after')).toBe(String(wait))
    expect(await refused.json()).toEqual({ error: 'busy', retryAfterSeconds: wait })
    // Another visitor still has their own.
    expect((await site.request(ask({ question: 'hi' }, { visitor: '198.51.100.2' }))).status).toBe(200)
  })

  it('has a daily ceiling for everyone together: the most typed questions can cost in a day', async () => {
    let time = 0
    const site = app({ model: modelReplying({ missionDays: 7 }), now: () => time })
    // A new visitor every time and 2.5 s apart (24 a minute), so no per-visitor or per-minute limit is reached first.
    for (let i = 0; i < LIMITS.ask.allDay; i++) {
      time = i * 2500
      expect((await site.request(ask({ question: 'hi' }, { visitor: `10.${Math.floor(i / 250)}.${i % 250}.1` }))).status, `question ${i + 1}`).toBe(200)
    }
    const refused = await site.request(ask({ question: 'hi' }, { visitor: '192.0.2.200' }))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBe(Math.ceil((24 * 60 * 60_000 - time) / 1000))
  })

  it('reports answers with nothing usable', async () => {
    expect((await app({ model: modelReplying({ sites: ['mars'] }) }).request(ask({ question: 'Mars' }))).status).toBe(422)
  })
})
