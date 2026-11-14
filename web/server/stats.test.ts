import { describe, expect, it, vi } from 'vitest'
import { countsOf, memoryStats, type StatsReader } from '../shared/stats'
import { createApp } from './app'

const ORIGIN = 'https://clps-web.example.run.app'
const NOON = Date.parse('2026-11-12T12:00:00Z')
const site = (overrides = {}) => createApp({ distDir: '/nonexistent', bucket: null, allowedOrigins: [], ...overrides })
const stats = (app: ReturnType<typeof site>) => app.request(`${ORIGIN}/api/stats`)

describe("today's counts, for the How it works page", () => {
  it('adds up the day\'s shards and says which day', async () => {
    const store = memoryStats()
    for (let i = 0; i < 12; i++) await store.count({ key: `e-${i}`, day: '2026-11-12', add: countsOf({ cached: i < 3, outcome: i === 11 ? 'error' : 'answered' }) })
    await store.count({ key: 'e-yesterday', day: '2026-11-11', add: countsOf({ cached: false, outcome: 'answered' }) })
    const response = await stats(site({ stats: store, now: () => NOON }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { shards: number }
    expect(body).toEqual({ day: '2026-11-12', counts: { questions: 12, cached: 3, fallback: 0, busy: 0, failed: 1, refused: 0 }, shards: expect.any(Number), asOf: '2026-11-12T12:00:00.000Z' })
    // Twelve events over eight shards: more than one document was added up.
    expect(body.shards).toBeGreaterThan(1)
  })

  it('answers zeros, not an error, when nothing has been counted today', async () => {
    const response = await stats(site({ stats: memoryStats(), now: () => NOON }))
    expect(await response.json()).toMatchObject({ day: '2026-11-12', counts: { questions: 0, cached: 0, fallback: 0, busy: 0, failed: 0 }, shards: 0 })
  })

  it('reads the database at most once every 30 seconds, and again on a new day', async () => {
    const clock = { ms: NOON }
    const store = memoryStats()
    const read = vi.fn(store.read)
    const app = site({ stats: { kind: 'memory', read } satisfies StatsReader, now: () => clock.ms })
    await stats(app)
    await store.count({ key: 'e-1', day: '2026-11-12', add: countsOf({ cached: false, outcome: 'answered' }) })
    clock.ms += 29_000
    expect(await (await stats(app)).json()).toMatchObject({ counts: { questions: 0 }, asOf: '2026-11-12T12:00:00.000Z' })
    expect(read).toHaveBeenCalledTimes(1)
    clock.ms += 1_000
    expect(await (await stats(app)).json()).toMatchObject({ counts: { questions: 1 } })
    expect(read).toHaveBeenCalledTimes(2)
    // Just after midnight UTC the day before is not shown as today.
    clock.ms = Date.parse('2026-11-13T00:00:05Z')
    expect(await (await stats(app)).json()).toMatchObject({ day: '2026-11-13', counts: { questions: 0 } })
  })

  it('says so when counts are not configured, or cannot be read, and tries again next time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await stats(site())).status).toBe(503)
    expect(await (await stats(site())).json()).toEqual({ error: 'not-configured' })

    let down = true
    const store = memoryStats()
    const app = site({ stats: { kind: 'firestore', read: (day: string) => (down ? Promise.reject(new Error('Firestore: HTTP 403 reading the counters')) : store.read(day)) } satisfies StatsReader, now: () => NOON })
    const failed = await stats(app)
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'unavailable' })
    down = false
    expect((await stats(app)).status).toBe(200)
    vi.restoreAllMocks()
  })

  it('is reported in the status, with the data version', async () => {
    const status = (await (await site({ stats: memoryStats(), dataVersion: '0123456789abcdef' }).request(`${ORIGIN}/api/status`)).json()) as Record<string, unknown>
    expect(status).toMatchObject({ counts: true, dataVersion: '0123456789abcdef' })
  })
})
