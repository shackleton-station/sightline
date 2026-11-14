import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCopilotApp } from './app'
import { memoryBreaker } from './breaker'
import type { Model } from './model'
import { apiError, claudeMessage, refusal, scriptedModel, textBlock } from './standIns'
import { fakeConnection, fakeRedis } from '../shared/fakeRedis'
import { redisStore } from '../shared/redisStore'
import { memoryStore } from '../shared/store'
import { dataDir, ORIGIN, PROGRAMS } from './testing'

/**
 * The contract test: the written description of the co-pilot API (API.md) checked against the code.
 *
 * For each reply API.md lists, a scenario here makes the real handler give it, and the body is
 * compared with the written shape both ways: every promised field is there with the promised type,
 * and nothing is sent that the description leaves out. The same pattern as web/plans/contract.test.ts.
 *
 * The pages' half (read only what is described, ignore the rest, obey Retry-After) is checked beside
 * the pages' own code, in src/lib/chatClient.test.ts.
 */
interface Reply {
  body?: unknown
  headers?: Record<string, string>
  events?: Record<string, unknown>
}
interface Operation {
  operation: string
  method: string
  path: string
  replies: Record<string, Reply>
}

const described: Operation[] = [...readFileSync(new URL('./API.md', import.meta.url), 'utf8').matchAll(/```json contract\n([\s\S]*?)```/g)].map(([, block]) => JSON.parse(block) as Operation)
const operation = (name: string) => {
  const found = described.find((item) => item.operation === name)
  if (!found) throw new Error(`API.md does not describe "${name}"`)
  return found
}

const KINDS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  'string|null': (value) => typeof value === 'string' || value === null,
  boolean: (value) => typeof value === 'boolean',
  number: (value) => typeof value === 'number',
  seconds: (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value),
  // A map whose field names are data (a count per kind of key), described in words below its block.
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'object|null': (value) => value === null || (typeof value === 'object' && !Array.isArray(value)),
}

/** Every way `value` differs from the written `shape`, as lines of text. None means it matches. */
function differences(value: unknown, shape: unknown, at = 'body'): string[] {
  if (typeof shape === 'string') {
    if (shape.startsWith('=')) return String(value) === shape.slice(1) ? [] : [`${at} is ${JSON.stringify(value)}, described as exactly "${shape.slice(1)}"`]
    return KINDS[shape]?.(value) ? [] : [`${at} is ${JSON.stringify(value)}, described as ${shape}`]
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${at} is not a list`]
    return value.flatMap((item, n) => differences(item, shape[0], `${at}[${n}]`))
  }
  if (typeof value !== 'object' || value === null) return [`${at} is not an object`]
  const fields = shape as Record<string, unknown>
  const got = value as Record<string, unknown>
  const names = Object.keys(fields).map((name) => name.replace(/\?$/, ''))
  return [
    ...Object.entries(fields).flatMap(([name, inner]) => {
      const plain = name.replace(/\?$/, '')
      if (!(plain in got)) return name.endsWith('?') ? [] : [`${at}.${plain} is missing`]
      return differences(got[plain], inner, `${at}.${plain}`)
    }),
    ...Object.keys(got)
      .filter((name) => !names.includes(name))
      .map((name) => `${at}.${name} is sent but not described in API.md`),
  ]
}

const VIEW = '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn'
const TALK = { messages: [{ role: 'user', text: 'How sunny is it?' }], view: VIEW }
const request = (path: string, body: unknown, init: { origin?: string; method?: string; visitor?: string; stream?: boolean } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', origin: init.origin ?? ORIGIN, 'x-forwarded-for': init.visitor ?? '203.0.113.7', ...(init.stream ? { accept: 'text/event-stream' } : {}) },
    body: init.method === 'GET' ? undefined : JSON.stringify(body),
  })
const failing = (status: number): Model => ({ generate: async () => Promise.reject(apiError(status)) })
const asking = (answer: unknown): Model => ({ generate: async () => claudeMessage({ content: [textBlock(JSON.stringify(answer))] }) })
const declining: Model = { generate: async () => refusal('general_harms') }
const openBreaker = async () => {
  const breaker = memoryBreaker()
  for (let i = 0; i < 5; i++) await breaker.failed(false)
  return breaker
}

describe.each(PROGRAMS)('the co-pilot API as API.md describes it, answered by $name', ({ site }) => {
  /** The replies both endpoints share, made for one path. */
  const common = (path: string, body: unknown, good: Model) => ({
    '400': () => site({ model: good }).request(request(path, path === '/api/chat' ? { messages: [] } : { question: '' })),
    '403': () => site({ model: good }).request(request(path, body, { origin: 'https://evil.example' })),
    '405': () => site({ model: good }).request(request(path, null, { method: 'GET' })),
    '429 limit': async () => {
      const app = site({ model: good, now: () => 0 })
      for (let i = 0; i < 10; i++) await app.request(request(path, body))
      return app.request(request(path, body))
    },
    '429 model': () => site({ model: failing(429) }).request(request(path, body)),
    '502': () => site({ model: failing(500) }).request(request(path, body)),
    '503 busy': async () => site({ model: good, breaker: await openBreaker() }).request(request(path, body)),
    '503 not-configured': () => site({ model: null }).request(request(path, body)),
  })

  const scenarios: Record<string, () => Response | Promise<Response>> = {
    'chat 200': () => site({ model: scriptedModel() }).request(request('/api/chat', TALK)),
    'chat 200 kept': async () => {
      const app = site({ model: scriptedModel() })
      await app.request(request('/api/chat', TALK))
      return app.request(request('/api/chat', TALK, { visitor: '198.51.100.2' }))
    },
    ...Object.fromEntries(Object.entries(common('/api/chat', TALK, scriptedModel())).map(([reply, make]) => [`chat ${reply}`, make])),
    'ask 200': () => site({ model: asking({ sites: ['connecting-ridge'], month: '2027-03', missionDays: 14 }) }).request(request('/api/ask', { question: 'two weeks in March 2027' })),
    'ask 422': () => site({ model: asking({ sites: ['mars'] }) }).request(request('/api/ask', { question: 'Mars' })),
    'ask 422 declined': () => site({ model: declining }).request(request('/api/ask', { question: 'something the model declines' })),
    ...Object.fromEntries(Object.entries(common('/api/ask', { question: 'hi' }, asking({ month: '2027-03' }))).map(([reply, make]) => [`ask ${reply}`, make])),
  }

  // The stream and the two status addresses are checked below.
  const plain = described.filter((item) => item.operation === 'chat' || item.operation === 'ask')

  it('has a scenario for every reply the description lists, and describes every scenario', () => {
    const listed = plain.flatMap((item) => Object.keys(item.replies).map((reply) => `${item.operation} ${reply}`))
    expect(Object.keys(scenarios).toSorted()).toEqual(listed.toSorted())
  })

  it.each(Object.keys(scenarios))('%s: the status, the body and the headers are as described', async (name) => {
    const [operationName, ...rest] = name.split(' ')
    const reply = operation(operationName).replies[rest.join(' ')]
    const response = await scenarios[name]()
    expect(response.status).toBe(Number(rest[0]))
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(differences(body, reply.body)).toEqual([])
    for (const [header, value] of Object.entries(reply.headers ?? {})) expect(differences(response.headers.get(header), value, `header ${header}`)).toEqual([])
    // The two halves of "busy" say the same wait.
    if (reply.headers?.['retry-after']) expect(String((body as { retryAfterSeconds?: number }).retryAfterSeconds)).toBe(response.headers.get('retry-after'))
  })

  it('streams only the events the description lists, ending with one reply or error', async () => {
    const stream = operation('chat-stream').replies['200']
    const check = async (response: Response, last: string) => {
      expect(response.status).toBe(200)
      for (const [header, value] of Object.entries(stream.headers ?? {})) expect(response.headers.get(header)).toBe(value)
      const events = (await response.text()).split('\n\n').filter(Boolean).map((block) => ({ name: /^event: (.*)$/m.exec(block)?.[1] ?? '', data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as unknown }))
      for (const event of events) {
        expect(Object.keys(stream.events ?? {})).toContain(event.name)
        expect(differences(event.data, stream.events?.[event.name], `event ${event.name}`)).toEqual([])
      }
      expect(events.at(-1)?.name).toBe(last)
      expect(events.filter((event) => event.name !== 'step')).toHaveLength(1)
    }
    await check(await site({ model: scriptedModel() }).request(request('/api/chat', TALK, { stream: true })), 'reply')
    await check(await site({ model: failing(500) }).request(request('/api/chat', TALK, { stream: true })), 'error')
  })

  it('ignores request fields and headers it does not know (the rule that lets a newer page call an older service)', async () => {
    const odd = request('/api/chat', { ...TALK, a_field_added_next_year: { nested: true } })
    odd.headers.set('x-a-header-added-next-year', '1')
    const response = await site({ model: scriptedModel() }).request(odd)
    expect(response.status).toBe(200)
    expect(differences(await response.json(), operation('chat').replies['200'].body)).toEqual([])
  })
})

describe('the status addresses, as API.md describes them', () => {
  const service = (statusCheck?: Parameters<typeof createCopilotApp>[0]['statusCheck']) =>
    createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], version: 'abc1234', codeVersion: 'c0de', dataVersion: 'da7a', revision: 'clps-copilot-00001-abc', statusCheck })

  it('reports the version, the data version and the code version in the described shape', async () => {
    const status = operation('status')
    const response = await service().request(`${ORIGIN}${status.path}`)
    expect(response.status).toBe(200)
    expect(differences(await response.json(), status.replies['200'].body)).toEqual([])
  })

  it('reports hit rates, single flights and memory in the described shape, with and without Redis', async () => {
    const cache = operation('cache-status')
    const without = await service().request(`${ORIGIN}${cache.path}`)
    expect(without.status).toBe(200)
    const empty = await without.json()
    expect(differences(empty, cache.replies['200'].body)).toEqual([])
    expect(empty).toMatchObject({ redis: { state: 'memory' }, days: [], memory: null })

    const redis = fakeRedis()
    const store = redisStore(redis, memoryStore())
    const app = createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], version: 'abc1234', codeVersion: 'c0de', dataVersion: 'da7a', revision: null, store, redis: fakeConnection() })
    await app.request(request('/api/chat', TALK))
    await app.request(request('/api/chat', TALK, { visitor: '198.51.100.2' }))
    const report = (await (await app.request(`${ORIGIN}${cache.path}`)).json()) as { days: { cache: unknown; flights: unknown }[]; memory: unknown }
    expect(differences(report, cache.replies['200'].body)).toEqual([])
    expect(report.days[0].cache).toEqual({ copilot: { hits: 1, misses: 1, hitRate: 0.5 } })
    expect(report.days[0].flights).toEqual({ copilot: { led: 1 } })
    expect(report.memory).toEqual({ usedBytes: 1_000_000, maxBytes: 0 })
  })

  it('answers the web server, and refuses everyone else, in the described shapes', async () => {
    const forWeb = operation('status-for-web')
    const check = async (authorization: string | null) => (authorization === 'Bearer web' ? { ok: true as const } : { ok: false as const, why: authorization === 'Bearer other' ? ('not-web' as const) : ('missing' as const) })
    const ask = (app: ReturnType<typeof service>, authorization?: string) => app.request(`${ORIGIN}${forWeb.path}`, { headers: authorization ? { authorization } : {} })
    const cases: [string, Response][] = [
      ['200', await ask(service(check), 'Bearer web')],
      ['401', await ask(service(check))],
      ['403', await ask(service(check), 'Bearer other')],
      ['503', await ask(service())],
    ]
    expect(cases.map(([reply]) => reply).toSorted()).toEqual(Object.keys(forWeb.replies).toSorted())
    for (const [reply, response] of cases) {
      expect(response.status).toBe(Number(reply))
      expect(differences(await response.json(), forWeb.replies[reply].body)).toEqual([])
    }
  })
})

describe('the description itself', () => {
  it('describes each operation once, with the methods and paths the service routes', () => {
    expect(described.map((item) => `${item.operation} ${item.method} ${item.path}`)).toEqual([
      'chat POST /api/chat',
      'chat-stream POST /api/chat',
      'ask POST /api/ask',
      'status GET /api/chat/status',
      'cache-status GET /api/chat/status/cache',
      'status-for-web GET /api/chat/status/web',
    ])
  })

  it('checks shapes the way it claims to: a missing, mistyped or extra field is each caught', () => {
    const shape = { text: 'string', 'n?': 'number', list: ['string'], month: 'string|null' }
    expect(differences({ text: 'a', list: ['b'], month: null }, shape)).toEqual([])
    expect(differences({ list: [], month: null }, shape)).toEqual(['body.text is missing'])
    expect(differences({ text: 1, list: [], month: null }, shape)).toHaveLength(1)
    expect(differences({ text: 'a', list: [2], month: null }, shape)).toHaveLength(1)
    expect(differences({ text: 'a', list: [], month: null, extra: true }, shape)).toEqual(['body.extra is sent but not described in API.md'])
    expect(differences('0', 'seconds')).toHaveLength(1)
  })
})
