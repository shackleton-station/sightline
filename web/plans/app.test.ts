import { describe, expect, it, vi } from 'vitest'
import { serviceLog } from '../shared/log'
import { redisStore, type RedisCommands } from '../shared/redisStore'
import { memoryStore } from '../shared/store'
import type { Span } from '../shared/trace'
import { createPlansApp, STATUS_FOR_WEB_PATH, STATUS_PATH } from './app'
import { memoryPlans } from './store'
import { dataDir, idOf, ORIGIN, save, VIEW } from './testing'

const service = (overrides = {}) => createPlansApp({ dataDir, allowedOrigins: [], plans: memoryPlans(), version: 'abc1234', dataVersion: '0123456789abcdef', revision: 'clps-plans-00007-xyz', ...overrides })

describe('the plans service on its own', () => {
  it('reports what it is running at a status address under /api/plans, without touching the database or a limit', async () => {
    const plans = memoryPlans()
    const get = vi.spyOn(plans, 'get')
    const app = service({ plans })
    // Far more often than any limit allows: the status address has none.
    for (let i = 0; i < 100; i++) expect((await app.request(`${ORIGIN}${STATUS_PATH}`)).status).toBe(200)
    const status = await app.request(`${ORIGIN}${STATUS_PATH}`)
    expect(status.headers.get('cache-control')).toBe('no-store')
    expect(await status.json()).toEqual({ service: 'plans', version: 'abc1234', revision: 'clps-plans-00007-xyz', region: null, dataVersion: '0123456789abcdef', store: 'memory', limits: 'memory', redis: { state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 }, signIn: false, tracing: false, idempotencyKeyHours: 24 })
    expect(get).not.toHaveBeenCalled()
  })

  it('answers the status meant for the web server only to a caller its check accepts', async () => {
    const statusCheck = vi.fn(async (authorization: string | null) => (authorization === 'Bearer from-web' ? { ok: true as const } : { ok: false as const, why: authorization ? ('not-web' as const) : ('missing' as const) }))
    const app = service({ statusCheck })
    const path = `${ORIGIN}${STATUS_FOR_WEB_PATH}`
    const fromWeb = await app.request(path, { headers: { authorization: 'Bearer from-web' } })
    expect(fromWeb.status).toBe(200)
    expect(await fromWeb.json()).toMatchObject({ service: 'plans', checkedAs: 'web' })
    expect((await app.request(path)).status).toBe(401)
    expect((await app.request(path, { headers: { authorization: 'Bearer someone-else' } })).status).toBe(403)
    expect((await service().request(path)).status).toBe(503)
    // A plan id has no slash in it, so this can never be a plan.
    expect(STATUS_FOR_WEB_PATH.slice('/api/plans/'.length)).toContain('/')
  })

  it('keeps the status address clear of every possible plan id', () => {
    // A plan id is 8 letters from the id alphabet. The last part of the status path is not.
    expect(STATUS_PATH.startsWith('/api/plans/')).toBe(true)
    expect(STATUS_PATH.slice('/api/plans/'.length)).not.toMatch(/^[a-hj-km-np-z2-9]{8}$/)
  })

  it('answers nothing but /api/plans: every other path is 404, the web server\'s status included', async () => {
    const app = service()
    for (const path of ['/', '/api/status', '/api/chat', '/data/sites.json', '/api/plansx', '/status']) {
      const response = await app.request(`${ORIGIN}${path}`)
      expect(response.status, path).toBe(404)
      expect(await response.json()).toEqual({ error: 'not-found' })
    }
    expect((await app.request(`${ORIGIN}${STATUS_PATH}`, { method: 'POST' })).status).toBe(405)
  })

  it('writes a brief with no bucket: the two data tools it uses never read the light grid', async () => {
    const app = service()
    const id = await idOf(await app.request(save({ title: 'No bucket', view: VIEW })))
    const { plan } = (await (await app.request(`${ORIGIN}/api/plans/${id}`)).json()) as { plan: { brief: { label: string }[] } }
    expect(plan.brief.map((item) => item.label)).toEqual(expect.arrayContaining(['Site', 'Time', 'Month', 'Checked against']))
  })

  it('joins the trace the load balancer started, and times each step under the request', async () => {
    const written: { traceId: string; spans: Span[] }[] = []
    const app = service({ traces: { write: (traceId: string, spans: Span[]) => void written.push({ traceId, spans }) } })
    const request = save({ title: 'Traced', view: VIEW }, { key: 'a-key-for-the-trace-test' })
    request.headers.set('x-cloud-trace-context', '105445aa7843bc8bf206b12000100000/1;o=1')
    expect((await app.request(request)).status).toBe(201)

    expect(written).toHaveLength(1)
    expect(written[0].traceId).toBe('105445aa7843bc8bf206b12000100000')
    const [root, ...steps] = written[0].spans
    // The request's own step hangs under the load balancer's, and carries how it ended.
    expect(root).toMatchObject({ name: 'POST /api/plans', parentSpanId: '0000000000000001', attributes: { status: '201' } })
    // A first save with a key makes one trip to the database, as a save without one does.
    expect(steps.map((step) => step.name)).toEqual(['brief from the data', 'save to Firestore'])
    // The same request again: the save is refused, and only then is the key looked up.
    const again = save({ title: 'Traced', view: VIEW }, { key: 'a-key-for-the-trace-test' })
    again.headers.set('x-cloud-trace-context', '205445aa7843bc8bf206b12000100000/1;o=1')
    expect((await app.request(again)).headers.get('idempotent-replayed')).toBe('true')
    expect(written[1].spans.slice(1).map((step) => step.name)).toEqual(['brief from the data', 'save to Firestore', 'look up the idempotency key'])
    for (const step of steps) expect(step.parentSpanId).toBe(root.spanId)
  })

  it('counts its limits in the same Redis keys as the web server, so a visitor has one allowance', async () => {
    const keys: string[] = []
    const redis: RedisCommands = { slidingWindow: (key) => (keys.push(key), Promise.resolve(1)), get: () => Promise.resolve(null), setEx: () => Promise.resolve() }
    const app = service({ store: redisStore(redis, memoryStore()) })
    await app.request(save({ title: 'x', view: VIEW }, { visitor: '203.0.113.7' }))
    await app.request(new Request(`${ORIGIN}/api/plans/abcdefgh`, { headers: { 'x-forwarded-for': '203.0.113.7' } }))
    expect(keys).toEqual(['clps:limit:plans:save:203.0.113.7', 'clps:limit:plans:save-day:all', 'clps:limit:plans:open:203.0.113.7'])
    expect(((await (await app.request(`${ORIGIN}${STATUS_PATH}`)).json()) as { limits: string }).limits).toBe('redis')
    // While Redis cannot be reached the limits are counted in memory, and the status says so.
    const cut = service({ store: redisStore(redis, memoryStore()), limitsReachable: () => false })
    expect(((await (await cut.request(`${ORIGIN}${STATUS_PATH}`)).json()) as { limits: string }).limits).toBe('redis-unreachable')
  })

  it('answers 502 and says why in its log when the database fails, and 500 never leaks an error', async () => {
    const complaint = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { ...memoryPlans(), get: () => Promise.reject(new Error('Firestore: HTTP 503 reading a plan')) }
    const response = await service({ plans: broken }).request(`${ORIGIN}/api/plans/abcdefgh`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream' })
    expect(complaint).toHaveBeenCalledOnce()
    complaint.mockRestore()
  })
})

describe('the service\'s log', () => {
  it('names the service and its version on every line, and the trace inside a request', () => {
    const lines: string[] = []
    const log = serviceLog('plans', 'abc1234', 'a-project', (line) => lines.push(line))
    log.info('listening on :8082')
    log.error('plans failed', { why: 'upstream' })
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { severity: 'INFO', message: 'listening on :8082', service: 'plans', version: 'abc1234' },
      { severity: 'ERROR', message: 'plans failed', service: 'plans', version: 'abc1234', why: 'upstream' },
    ])
  })
})
