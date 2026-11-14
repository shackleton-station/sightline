import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { googleCallers, SIGNATURE_REMOVED } from '../shared/caller'
import { pushBody, type QuestionEvent } from '../shared/events'
import { googleTokens, type SigningKey } from '../shared/googleJwt'
import type { Log } from '../shared/log'
import { memoryStats, type StatsStore } from '../shared/stats'
import type { Span } from '../shared/trace'
import { createWorker, type WorkerDeps } from './app'

const URL = 'https://events-worker.example.run.app'
const NOW = Date.parse('2026-11-12T12:00:00Z')
const PUSH = 'clps-events-push@project.iam.gserviceaccount.com'
const DEPLOYER = 'clps-web-deployer@project.iam.gserviceaccount.com'

// A stand-in for Google: a key pair made here, published the way Google publishes its own.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const published: SigningKey = { kid: 'key-1', kty: 'RSA', n: jwk.n ?? '', e: jwk.e ?? '', alg: 'RS256' }
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** A token as Pub/Sub attaches to a push: signed by Google, naming the service account it delivers as. */
function token(claims: Record<string, unknown> = {}, signWith = privateKey): string {
  const head = part({ alg: 'RS256', kid: 'key-1', typ: 'JWT' })
  const body = part({ iss: 'https://accounts.google.com', aud: URL, email: PUSH, email_verified: true, sub: '1', iat: NOW / 1000 - 60, exp: NOW / 1000 + 3540, ...claims })
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(signWith).toString('base64url')}`
}

const question = (overrides: Partial<QuestionEvent> = {}): QuestionEvent => ({
  kind: 'copilot_question',
  id: '3f0c2f0e-6c58-4c53-9b1c-0d7e5a1f2b3c',
  at: '2026-11-12T11:59:00.000Z',
  question: 'How sunny is it at my secret site?',
  site: 'connecting-ridge',
  month: '2027-05',
  lookups: ['Connecting Ridge, May 2027: month summary'],
  cached: false,
  ms: 1200,
  outcome: 'answered',
  ...overrides,
})

function worker(overrides: Partial<WorkerDeps> = {}) {
  const lines: string[] = []
  const note = (message: string, fields: Record<string, unknown> = {}) => void lines.push(JSON.stringify({ message, ...fields }))
  const log: Log = { info: note, warn: note, error: note }
  const stats = memoryStats()
  const callers = googleCallers({ tokens: googleTokens(() => Promise.resolve({ keys: [published], keepMs: 3_600_000 }), () => NOW), behindCloudRun: false, now: () => NOW })
  const app = createWorker({ stats, callers, pushIdentity: PUSH, checkIdentities: [DEPLOYER], log, version: 'abc1234', dataVersion: '0123456789abcdef', revision: 'events-worker-00001', now: () => NOW, ...overrides })
  return { app, stats: overrides.stats ?? stats, lines }
}

function push(body: string, authorization: string | null = `Bearer ${token()}`): Request {
  return new Request(`${URL}/push`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body })
}
const pushed = (event: Record<string, unknown>, messageId = '1001', attributes: Record<string, string> = { kind: 'copilot_question' }) => push(pushBody(event, attributes, messageId, 1))

const DAY = '2026-11-12'

describe('a pushed event', () => {
  it('adds to the day it was asked on: one question, and one more for how it ended', async () => {
    const { app, stats } = worker()
    expect((await app.request(pushed({ ...question() }))).status).toBe(204)
    expect((await app.request(pushed({ ...question({ id: 'b', cached: true }) }, '1002'))).status).toBe(204)
    expect((await app.request(pushed({ ...question({ id: 'c', outcome: 'fallback' }) }, '1003'))).status).toBe(204)
    expect((await app.request(pushed({ ...question({ id: 'd', outcome: 'busy' }) }, '1004'))).status).toBe(204)
    expect((await app.request(pushed({ ...question({ id: 'e', outcome: 'error' }) }, '1005'))).status).toBe(204)
    // Asked just before midnight UTC, delivered after: it belongs to the day it was asked.
    expect((await app.request(pushed({ ...question({ id: 'f', at: '2026-11-11T23:59:59.000Z' }) }, '1006'))).status).toBe(204)
    expect(await stats.read(DAY)).toMatchObject({ counts: { questions: 5, cached: 1, fallback: 1, busy: 1, failed: 1 } })
    expect((await stats.read('2026-11-11')).counts.questions).toBe(1)
  })

  it('keeps counts only: the question\'s words are never stored or logged', async () => {
    const { app, stats, lines } = worker()
    await app.request(pushed({ ...question() }))
    await app.request(pushed({ ...question({ at: 'never' }) }, '1002'))
    expect(JSON.stringify(await stats.read(DAY))).not.toContain('secret')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('secret')
    expect(lines.join('\n')).not.toContain('connecting-ridge')
  })

  it('counts the same event once, however many times it is delivered', async () => {
    const { app, stats } = worker()
    // Pub/Sub delivering the same message again...
    for (let i = 0; i < 3; i++) expect((await app.request(pushed({ ...question() }, '1001'))).status).toBe(204)
    // ...and the outbox relay publishing the same event again, which gives it a new message id.
    expect((await app.request(pushed({ ...question() }, '2002'))).status).toBe(204)
    expect((await stats.read(DAY)).counts).toEqual({ questions: 1, cached: 0, fallback: 0, busy: 0, failed: 0, refused: 0 })
    // A different event is a different question.
    await app.request(pushed({ ...question({ id: 'another-one' }) }, '3003'))
    expect((await stats.read(DAY)).counts.questions).toBe(2)
  })

  it('falls back to the message id for an event published without an id of its own', async () => {
    const { app, stats } = worker()
    const old: Record<string, unknown> = { ...question() }
    delete old.id
    await app.request(pushed(old, '1001'))
    await app.request(pushed(old, '1001'))
    expect((await stats.read(DAY)).counts.questions).toBe(1)
    await app.request(pushed(old, '1002'))
    expect((await stats.read(DAY)).counts.questions).toBe(2)
  })

  it('acknowledges an event of another kind without counting it', async () => {
    const { app, stats } = worker()
    expect((await app.request(pushed({ kind: 'plan_saved', at: '2026-11-12T11:00:00Z' }))).status).toBe(204)
    expect((await stats.read(DAY)).shards).toBe(0)
  })
})

describe('who may push', () => {
  it('lets in only the push subscription\'s own identity', async () => {
    const { app, stats } = worker()
    const body = pushBody({ ...question() }, {}, '1001')
    // No token, and something that is not a token.
    expect((await app.request(push(body, null))).status).toBe(401)
    expect((await app.request(push(body, 'Bearer not-a-token'))).status).toBe(401)
    expect((await app.request(push(body, 'Basic abc'))).status).toBe(401)
    // Signed by someone else's key, expired, or from another issuer.
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    expect((await app.request(push(body, `Bearer ${token({}, stranger)}`))).status).toBe(401)
    expect((await app.request(push(body, `Bearer ${token({ exp: NOW / 1000 - 3600 })}`))).status).toBe(401)
    expect((await app.request(push(body, `Bearer ${token({ iss: 'https://accounts.evil.example' })}`))).status).toBe(401)
    expect((await app.request(push(body, `Bearer ${token({ email_verified: false })}`))).status).toBe(401)
    // A real Google identity that may call the service, but is not the one that delivers messages.
    expect((await app.request(push(body, `Bearer ${token({ email: DEPLOYER })}`))).status).toBe(403)
    expect((await stats.read(DAY)).shards).toBe(0)
    expect((await app.request(push(body))).status).toBe(204)
    expect((await stats.read(DAY)).counts.questions).toBe(1)
  })

  it('accepts a token whose signature Cloud Run removed only when running behind Cloud Run', async () => {
    const [head, claims] = token().split('.')
    const stripped = `Bearer ${head}.${claims}.${SIGNATURE_REMOVED}`
    const body = pushBody({ ...question() }, {}, '1001')
    expect((await worker().app.request(push(body, stripped))).status).toBe(401)

    const keys = () => Promise.resolve({ keys: [published], keepMs: 3_600_000 })
    const behind = worker({ callers: googleCallers({ tokens: googleTokens(keys, () => NOW), behindCloudRun: true, now: () => NOW }) })
    expect((await behind.app.request(push(body, stripped))).status).toBe(204)
    // Still only the push identity, and still not after it has expired.
    const other = token({ email: DEPLOYER }).split('.')
    expect((await behind.app.request(push(body, `Bearer ${other[0]}.${other[1]}.${SIGNATURE_REMOVED}`))).status).toBe(403)
    const old = token({ exp: NOW / 1000 - 3600 }).split('.')
    expect((await behind.app.request(push(body, `Bearer ${old[0]}.${old[1]}.${SIGNATURE_REMOVED}`))).status).toBe(401)
  })

  it('asks nobody when no identity is configured (one machine only)', async () => {
    const { app } = worker({ callers: null, pushIdentity: null })
    expect((await app.request(push(pushBody({ ...question() }, {}, '1001'), null))).status).toBe(204)
  })
})

describe('a message that cannot be counted', () => {
  it('is refused every time, so Pub/Sub retries it and then sets it aside', async () => {
    const { app, stats } = worker()
    const data = (text: string) => JSON.stringify({ message: { data: Buffer.from(text).toString('base64'), messageId: '1' }, subscription: 's' })
    const bodies = [
      'not json',
      '{}',
      JSON.stringify({ message: {} }),
      JSON.stringify({ message: { data: '%%% not base64 json %%%', messageId: '1' } }),
      data('not json inside'),
      data('"a string"'),
      data(JSON.stringify({ at: '2026-11-12T11:00:00Z', cached: false, outcome: 'answered' })), // no kind
      data(JSON.stringify({ ...question(), at: 'yesterday' })),
      data(JSON.stringify({ ...question(), cached: 'yes' })),
      data(JSON.stringify({ ...question(), outcome: 'shrug' })),
      data(JSON.stringify({ ...question(), id: 'not/a/safe/id' })),
      'x'.repeat(100_001),
    ]
    for (const body of bodies) {
      // The same answer on every delivery: it is the count of refusals that moves it to the dead-letter topic.
      for (let attempt = 0; attempt < 2; attempt++) expect((await app.request(push(body))).status, body.slice(0, 40)).toBe(400)
    }
    expect((await stats.read(DAY)).shards).toBe(0)
  })

  it('answers "try again" when the store fails, and counts the event when it is delivered again', async () => {
    const real = memoryStats()
    let broken = true
    const stats: StatsStore = { kind: 'memory', read: real.read, count: (event, keep) => (broken ? Promise.reject(new Error('Firestore: ABORTED counting an event')) : real.count(event, keep)) }
    const { app } = worker({ stats })
    expect((await app.request(pushed({ ...question() }))).status).toBe(503)
    broken = false
    expect((await app.request(pushed({ ...question() }))).status).toBe(204)
    expect((await real.read(DAY)).counts.questions).toBe(1)
  })

  it('refuses everything while paused, so messages wait in the queue', async () => {
    const { app, stats } = worker({ paused: true })
    expect((await app.request(pushed({ ...question() }))).status).toBe(503)
    expect((await stats.read(DAY)).shards).toBe(0)
    expect(await (await app.request(`${URL}/status`)).json()).toMatchObject({ paused: true })
  })

  it('only takes a POST', async () => {
    expect((await worker().app.request(`${URL}/push`)).status).toBe(405)
    expect((await worker().app.request(`${URL}/anything-else`)).status).toBe(404)
  })
})

describe('the worker itself', () => {
  it('reports its version and the version of the site data it was built with', async () => {
    const response = await worker().app.request(`${URL}/status`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ service: 'events-worker', version: 'abc1234', revision: 'events-worker-00001', dataVersion: '0123456789abcdef', store: 'memory', shards: 8, callerCheck: 'on', paused: false })
  })

  it('checks its own write path for the deployer, and for nobody else', async () => {
    const { app, stats } = worker()
    const check = (authorization: string | null) => app.request(new Request(`${URL}/selfcheck`, { method: 'POST', headers: authorization ? { authorization } : {} }))
    expect((await check(null)).status).toBe(401)
    expect((await check(`Bearer ${token()}`)).status).toBe(403)
    const passed = await check(`Bearer ${token({ email: DEPLOYER })}`)
    expect(passed.status).toBe(200)
    expect(await passed.json()).toEqual({ ok: true, first: 'counted', second: 'duplicate', questions: 1 })
    // It counted on a scratch day, never on a real one.
    expect((await stats.read(DAY)).shards).toBe(0)

    // A store that counts a duplicate twice fails the check.
    const real = memoryStats()
    let n = 0
    const careless: StatsStore = { kind: 'memory', read: real.read, count: (event) => real.count({ ...event, key: `${event.key}-${n++}` }) }
    const failed = await worker({ stats: careless }).app.request(new Request(`${URL}/selfcheck`, { method: 'POST', headers: { authorization: `Bearer ${token({ email: DEPLOYER })}` } }))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ ok: false, second: 'counted', questions: 2 })
  })

  it('serves the counts over HTTP only when asked to (one machine, no shared database)', async () => {
    expect((await worker().app.request(`${URL}/counts`)).status).toBe(404)
    const { app } = worker({ localReads: true, callers: null, pushIdentity: null })
    await app.request(push(pushBody({ ...question() }, {}, '1'), null))
    expect(await (await app.request(`${URL}/counts`)).json()).toMatchObject({ day: DAY, counts: { questions: 1 }, shards: 1 })
    expect((await app.request(`${URL}/counts?day=nope`)).status).toBe(400)
  })

  it('joins the trace of the request that asked the question, through the message\'s attributes', async () => {
    const write = vi.fn<(traceId: string, spans: Span[]) => void>()
    const { app } = worker({ traces: { write } })
    const traceparent = '00-105445aa7843bc8bf206b12000100000-00f067aa0ba902b7-01'
    await app.request(pushed({ ...question() }, '1001', { kind: 'copilot_question', traceparent }))
    expect(write).toHaveBeenCalledTimes(1)
    const [traceId, spans] = write.mock.calls[0]
    expect(traceId).toBe('105445aa7843bc8bf206b12000100000')
    expect(spans[0]).toMatchObject({ name: 'events-worker: count a question', parentSpanId: '00f067aa0ba902b7', attributes: { result: 'counted', day: DAY } })

    // With no trace in the message, or a broken one, it starts its own.
    await app.request(pushed({ ...question({ id: 'x' }) }, '1002', { traceparent: 'nonsense' }))
    expect(write.mock.calls[1][0]).toMatch(/^[0-9a-f]{32}$/)
    expect(write.mock.calls[1][1][0].parentSpanId).toBeNull()
  })
})
