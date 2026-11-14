import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { googleTokens, type SigningKey } from '../shared/googleJwt'
import { statusCaller } from '../shared/statusCaller'
import { memoryStore } from '../shared/store'
import { createCopilotApp } from './app'
import { memoryBreaker } from './breaker'
import type { Model } from './model'
import { apiError, claudeMessage, faultyModel, readFaults, scriptedModel, textBlock } from './standIns'
import { dataDir, ORIGIN, PROGRAMS } from './testing'

const talk = { messages: [{ role: 'user', text: 'How sunny is it?' }], view: '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn' }
const post = (body: unknown, init: { visitor?: string; stream?: boolean } = {}) =>
  new Request(`${ORIGIN}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': init.visitor ?? '203.0.113.7', ...(init.stream ? { accept: 'text/event-stream' } : {}) },
    body: JSON.stringify(body),
  })

const service = (overrides: Partial<Parameters<typeof createCopilotApp>[0]> = {}) =>
  createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], version: 'abc1234', codeVersion: 'c0de', dataVersion: 'da7a', revision: 'clps-copilot-00001-abc', retry: { wait: async () => {} }, ...overrides })

describe('the co-pilot service', () => {
  it('reports what it runs at /api/chat/status, which the load balancer sends it', async () => {
    const response = await service().request(`${ORIGIN}/api/chat/status`)
    expect(await response.json()).toEqual({
      service: 'copilot',
      version: 'abc1234',
      revision: 'clps-copilot-00001-abc',
      region: null,
      dataVersion: 'da7a',
      codeVersion: 'c0de',
      model: 'claude',
      modelSettings: null,
      limits: 'memory',
      redis: { state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 },
      answers: 'memory',
      breakerStore: 'memory',
      questionLog: false,
      tracing: false,
    })
    expect((await service().request(`${ORIGIN}/api/plans`)).status).toBe(404)
    expect((await service().request(`${ORIGIN}/api/chat/anything-else`)).status).toBe(404)
  })

  it('answers a streamed question from end to end with the scripted stand-in, and never compresses the stream', async () => {
    const request = post(talk, { stream: true })
    request.headers.set('accept-encoding', 'gzip')
    const response = await service().request(request)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('content-encoding')).toBeNull()
    const text = await response.text()
    expect(text).toContain('event: step')
    expect(text).toMatch(/event: reply\ndata: \{"reply":\{"text":"The Sun is up 59\.5% of May 2027 at Connecting Ridge/)
  })
})

describe('while the circuit breaker is open', () => {
  const failing = (): Model & { generate: ReturnType<typeof vi.fn> } => ({ generate: vi.fn(async () => Promise.reject(apiError(503))) })

  it.each(PROGRAMS)('$name answers at once with 503 and Retry-After, and calls no model', async (program) => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    const model = failing()
    const app = program.site({ model, breaker, now: () => time })
    // Five questions that each fail after their retries open it.
    for (let i = 0; i < 5; i++) expect((await app.request(post({ ...talk, messages: [{ role: 'user', text: `question ${i}` }] }, { visitor: `198.51.100.${i}` }))).status).toBe(502)
    expect(model.generate).toHaveBeenCalledTimes(15)
    model.generate.mockClear()

    time = 12_000
    const refused = await app.request(post(talk))
    expect(refused.status).toBe(503)
    expect(refused.headers.get('retry-after')).toBe('18')
    expect(await refused.json()).toEqual({ error: 'busy', retryAfterSeconds: 18 })
    // A streamed question too: refused before any stream starts, so it can carry the header.
    const streamed = await app.request(post(talk, { stream: true, visitor: '192.0.2.9' }))
    expect(streamed.status).toBe(503)
    expect(streamed.headers.get('retry-after')).toBe('18')
    expect(model.generate).not.toHaveBeenCalled()

    // Thirty seconds after it opened, one question is the trial; the model is back, and it closes.
    time = 30_000
    model.generate.mockImplementation(scriptedModel().generate)
    expect((await app.request(post(talk, { visitor: '192.0.2.10' }))).status).toBe(200)
  })

  it.each(PROGRAMS)('$name logs a refused question as busy, for the day’s counts', async (program) => {
    const breaker = memoryBreaker()
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    const publish = vi.fn()
    const app = program.site({ model: scriptedModel(), breaker, events: { publish } })
    expect((await app.request(post(talk))).status).toBe(503)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({ kind: 'copilot_question', outcome: 'busy', cached: false, lookups: [] })
  })

  it.each(PROGRAMS)('$name still gives a kept answer: it needs no model', async (program) => {
    let time = 0
    const breaker = memoryBreaker(() => time)
    const model: Model = { generate: vi.fn(scriptedModel().generate) }
    const store = memoryStore(() => time)
    const app = program.site({ model, breaker, store, now: () => time })
    expect((await app.request(post(talk))).headers.get('x-cache')).toBe('miss')
    for (let i = 0; i < 5; i++) await breaker.failed(false)
    const kept = await app.request(post(talk, { visitor: '198.51.100.7' }))
    expect(kept.status).toBe(200)
    expect(kept.headers.get('x-cache')).toBe('hit')
  })

  it('tells a stream that was already under way, in the stream, how long to wait', async () => {
    // The breaker opens while the question is being answered (another copy saw the failures): the
    // next model call is refused, and there are no facts yet to fall back on.
    let time = 0
    const breaker = memoryBreaker(() => time)
    let calls = 0
    const model: Model = {
      async generate() {
        calls += 1
        for (let i = 0; i < 5; i++) await breaker.failed(false)
        return claudeMessage({ content: [] })
      },
    }
    const response = await service({ model, breaker, now: () => time }).request(post(talk, { stream: true }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('event: error\ndata: {"error":"busy","retryAfterSeconds":30}\n\n')
    expect(calls).toBe(1)
  })
})

describe('kept answers', () => {
  it('are never given for other code or other data', async () => {
    const store = memoryStore()
    await service({ store }).request(post(talk))
    expect((await service({ store, codeVersion: 'newer' }).request(post(talk, { visitor: '198.51.100.3' }))).headers.get('x-cache')).toBe('miss')
    expect((await service({ store, dataVersion: 'rebuilt' }).request(post(talk, { visitor: '198.51.100.4' }))).headers.get('x-cache')).toBe('miss')
    expect((await service({ store }).request(post(talk, { visitor: '198.51.100.5' }))).headers.get('x-cache')).toBe('hit')
  })
})

// A stand-in for Google: a key pair made here, published the way Google publishes its own.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const published: SigningKey = { kid: 'k1', kty: 'RSA', n: jwk.n ?? '', e: jwk.e ?? '', alg: 'RS256' }
const NOW = Date.parse('2026-11-12T12:00:00Z')
const WEB = 'clps-web@clps-compute-6z1nc.iam.gserviceaccount.com'
function token(claims: Record<string, unknown> = {}) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const head = part({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = part({ iss: 'https://accounts.google.com', aud: 'clps-copilot', email: WEB, email_verified: true, iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, ...claims })
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`
}
const statusCheck = statusCaller({ tokens: googleTokens(async () => ({ keys: [published], keepMs: 3_600_000 }), () => NOW), audience: 'clps-copilot', caller: WEB })

describe('the status meant for the web server', () => {
  const ask = (authorization?: string) => service({ statusCheck }).request(`${ORIGIN}/api/chat/status/web`, { headers: authorization ? { authorization } : {} })

  it('answers the web server, with the breaker’s state', async () => {
    const response = await ask(`Bearer ${token()}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ service: 'copilot', breaker: { state: 'closed', retryAfterSeconds: 0, opensAfter: 5, withinSeconds: 60, openSeconds: 30 }, retries: 2 })
  })

  it('refuses no token, a token for another service, an expired one, and anyone but the web server', async () => {
    expect((await ask()).status).toBe(401)
    expect((await ask(`Bearer ${token({ aud: 'clps-plans' })}`)).status).toBe(401)
    expect((await ask(`Bearer ${token({ exp: NOW / 1000 - 600 })}`)).status).toBe(401)
    expect((await ask(`Bearer ${token({ email: 'someone-else@example.com' })}`)).status).toBe(403)
    expect((await ask(`Bearer ${token({ email_verified: false })}`)).status).toBe(403)
    expect((await ask(`Bearer ${token().slice(0, -4)}AAAA`)).status).toBe(401)
  })

  it('says it is not set up when the service was not told who may call it', async () => {
    expect((await service().request(`${ORIGIN}/api/chat/status/web`)).status).toBe(503)
  })
})

describe('the stand-ins for the model', () => {
  it('reads MODEL_FAULTS only in its exact form, so a typo switches nothing on', () => {
    expect(readFaults('503@100')).toEqual({ status: 503, percent: 100 })
    expect(readFaults(' 429@12.5 ')).toEqual({ status: 429, percent: 12.5 })
    for (const value of [undefined, '', 'on', '503', '200@50', '503@0', '503@101', '503 @ 50']) expect(readFaults(value)).toBeNull()
  })

  it('fails the given share of calls without calling the model', async () => {
    const inner: Model = { generate: vi.fn(async () => claudeMessage({ content: [textBlock('Hello.')] })) }
    const model = faultyModel(inner, { status: 529, percent: 50 }, (() => {
      const draws = [0.1, 0.9]
      let i = 0
      return () => draws[i++ % 2]
    })())
    const request = { messages: [{ role: 'user' as const, content: 'Hello' }], max_tokens: 64 }
    // The injected failure is the SDK's own typed error, so the retries and the breaker treat it as the real thing.
    await expect(model.generate(request, AbortSignal.timeout(1000))).rejects.toMatchObject({ status: 529 })
    expect((await model.generate(request, AbortSignal.timeout(1000))).stop_reason).toBe('end_turn')
    expect(inner.generate).toHaveBeenCalledTimes(1)
  })
})

describe('the status names the model and how it signs in, never a secret', () => {
  it('reports model, speed, effort, fallbacks and the way in', async () => {
    const status = async (overrides: Partial<Parameters<typeof createCopilotApp>[0]>) => (await (await service(overrides).request(`${ORIGIN}/api/chat/status`)).json()) as Record<string, unknown>
    expect((await status({ modelKind: 'claude', modelSettings: { model: 'claude-opus-5-5', speed: 'fast', effort: 'low' }, modelAuth: 'federation' })).modelSettings).toEqual({
      model: 'claude-opus-5-5',
      speed: 'fast',
      effort: 'low',
      fallbacks: 'default',
      auth: 'federation',
    })
    // Sonnet 5.5 has no fast mode: no speed field is sent, and the status says so with null.
    expect((await status({ modelSettings: { model: 'claude-sonnet-5-5', speed: null, effort: 'low' }, modelAuth: 'api-key' })).modelSettings).toMatchObject({ speed: null, auth: 'api-key' })
    // No model, no settings.
    expect((await status({ model: null, modelSettings: { model: 'claude-opus-5-5', speed: 'fast', effort: 'low' } })).modelSettings).toBeNull()
  })
})
