import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { memoryStore } from '../shared/store'
import { createCopilotApp } from './app'
import { horizonsForTools, queryUrl, readLookup, readReply } from './horizons'
import { scriptedModel } from './standIns'
import { dataDir, ORIGIN } from './testing'

// A real reply from Horizons, recorded for the pipeline's tests: the Sun from a point on the Moon, three hourly rows.
const RECORDED = readFileSync(new URL('../../pipeline/tests/fixtures/horizons_sun_im2_20270101.txt', import.meta.url), 'utf8')
// The span the route is given: the data's own (range.json), read by the service.
const SPAN = JSON.parse(readFileSync(new URL('../public/data/range.json', import.meta.url), 'utf8')) as { start: string; end: string }
const look = { lat: -88.5, lon: 40, altKm: 1.2, hour: '2027-05-06T13:00:00Z' }

const post = (body: unknown, visitor = '203.0.113.7', origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/chat/horizons`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': visitor }, body: JSON.stringify(body) })

function service(jpl: typeof fetch) {
  return createCopilotApp({ dataDir, bucket: null, model: scriptedModel(), allowedOrigins: [], version: 'abc1234', codeVersion: 'c0de', dataVersion: 'da7a', revision: 'r', store: memoryStore(), horizonsFetch: jpl })
}
const answering = () => vi.fn<typeof fetch>(async () => new Response(RECORDED))

describe('reading a lookup', () => {
  it('takes a point on the Moon and a whole hour inside the data', () => {
    expect(readLookup(JSON.stringify(look), SPAN)).toEqual({ lat: -88.5, lon: 40, altKm: 1.2, hour: '2027-05-06T13:00:00Z' })
    expect(readLookup(JSON.stringify({ ...look, lon: -137.1486, altKm: undefined }), SPAN)).toEqual({ lat: -88.5, lon: 222.8514, altKm: 0, hour: look.hour })
  })

  it('refuses anything else', () => {
    for (const bad of [{ ...look, lat: 91 }, { ...look, lon: 400 }, { ...look, altKm: 50 }, { ...look, hour: '2027-05-06T13:30:00Z' }, { ...look, hour: SPAN.end }, { ...look, hour: '1999-01-01T00:00:00Z' }, { ...look, hour: 'now' }, { ...look, lat: '1' }, 'text', null]) {
      expect(readLookup(JSON.stringify(bad), SPAN)).toBeNull()
    }
    expect(readLookup('{', SPAN)).toBeNull()
    expect(readLookup(JSON.stringify({ ...look, pad: 'x'.repeat(500) }), SPAN)).toBeNull()
  })
})

describe('the query sent to Horizons', () => {
  const url = new URL(queryUrl('earth', look))

  it('is the pipeline’s: a surface point on the Moon, apparent azimuth and elevation in degrees, one hour', () => {
    expect(url.origin + url.pathname).toBe('https://ssd.jpl.nasa.gov/api/horizons.api')
    expect(url.searchParams.get('COMMAND')).toBe("'399'")
    expect(url.searchParams.get('CENTER')).toBe("'coord@301'")
    expect(url.searchParams.get('SITE_COORD')).toBe("'40,-88.5,1.2'")
    expect(url.searchParams.get('START_TIME')).toBe("'2027-05-06 13:00'")
    expect(url.searchParams.get('STOP_TIME')).toBe("'2027-05-06 13:01'")
    expect(url.searchParams.get('QUANTITIES')).toBe("'4'")
    expect(url.searchParams.get('ANG_FORMAT')).toBe("'DEG'")
  })
})

describe('reading a reply', () => {
  it('takes the first row’s azimuth and elevation, and the ephemeris named', () => {
    expect(readReply(RECORDED)).toEqual({ azDeg: 233.95817, elDeg: -2.053957, ephemeris: 'DE441' })
  })

  it('is nothing for an error page', () => {
    expect(readReply('No ephemeris for target')).toBeNull()
    expect(readReply('$$SOE\n$$EOE')).toBeNull()
  })
})

describe('POST /api/chat/horizons', () => {
  it('asks Horizons for the Sun, then Earth, and gives both', async () => {
    const jpl = answering()
    const response = await service(jpl).request(post(look))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...look, sun: { azDeg: 233.95817, elDeg: -2.053957 }, earth: { azDeg: 233.95817, elDeg: -2.053957 }, ephemeris: 'DE441', cached: false })
    expect(jpl).toHaveBeenCalledTimes(2)
    expect(new URL(String(jpl.mock.calls[0][0])).searchParams.get('COMMAND')).toBe("'10'")
    expect(new URL(String(jpl.mock.calls[1][0])).searchParams.get('COMMAND')).toBe("'399'")
    expect(new Headers(jpl.mock.calls[0][1]?.headers).get('user-agent')).toMatch(/lunar-visibility-check/)
  })

  it('answers the same lookup again from the cache, without asking Horizons', async () => {
    const jpl = answering()
    const app = service(jpl)
    await app.request(post(look))
    const again = await app.request(post(look, '198.51.100.9'))
    expect(((await again.json()) as { cached: boolean }).cached).toBe(true)
    expect(jpl).toHaveBeenCalledTimes(2)
  })

  it('fails quietly when Horizons is down, slow or says something else', async () => {
    const down = await service(vi.fn<typeof fetch>(async () => new Response('busy', { status: 503 }))).request(post(look))
    expect(down.status).toBe(502)
    expect(await down.json()).toEqual({ error: 'upstream' })
    const broken = await service(vi.fn<typeof fetch>(async () => { throw new Error('timed out') })).request(post(look))
    expect(broken.status).toBe(502)
    const odd = await service(vi.fn<typeof fetch>(async () => new Response('not a table'))).request(post(look))
    expect(odd.status).toBe(502)
  })

  it('is for this site’s pages only, by POST, with a point and an hour', async () => {
    const jpl = answering()
    const app = service(jpl)
    expect((await app.request(post(look, '203.0.113.7', 'https://elsewhere.example'))).status).toBe(403)
    expect((await app.request(`${ORIGIN}/api/chat/horizons`)).status).toBe(405)
    expect((await app.request(post({ ...look, lat: 200 }))).status).toBe(400)
    expect(jpl).not.toHaveBeenCalled()
  })

  it('lets a visitor ask six times a minute, then says when to come back', async () => {
    const app = service(answering())
    for (let i = 0; i < 6; i += 1) expect((await app.request(post({ ...look, lat: -88 - i / 100 }))).status).toBe(200)
    const refused = await app.request(post({ ...look, lat: -87 }))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('Scout’s way to the same lookup', () => {
  const limits = () => {
    const store = memoryStore()
    return { store, all: store.limiter('t:all', 20, 60_000), allDay: store.limiter('t:day', 2000, 86_400_000) }
  }
  const site = { id: 'connecting-ridge', name: 'Connecting Ridge', lat: -89.45, lon: 222.69, source_url: '', group: '' }

  it('asks at the height the pipeline’s own comparison used for the site, and keeps the answer where the route finds it', async () => {
    const jpl = answering()
    const { store, all, allDay } = limits()
    const ask = horizonsForTools(dataDir, { fetch: jpl }, { all, allDay }, store.cache)
    const height = (JSON.parse(readFileSync(`${dataDir}/horizons.json`, 'utf8')) as { sites: Record<string, { alt_km: number }> }).sites['connecting-ridge'].alt_km

    const found = await ask(site, look.hour)
    expect(found).toEqual({ sun: { azDeg: 233.95817, elDeg: -2.053957 }, earth: { azDeg: 233.95817, elDeg: -2.053957 }, ephemeris: 'DE441', altKm: Number(height.toFixed(3)) })
    expect(new URL(String(jpl.mock.calls[0][0])).searchParams.get('SITE_COORD')).toBe(`'222.69,-89.45,${Number(height.toFixed(3))}'`)
    await ask(site, look.hour)
    expect(jpl).toHaveBeenCalledTimes(2)
  })

  it('is busy once the shared limit on requests to JPL is used up, and silent when Horizons is', async () => {
    const store = memoryStore()
    const one = { all: store.limiter('t:all', 1, 60_000), allDay: store.limiter('t:day', 2000, 86_400_000) }
    const ask = horizonsForTools(dataDir, { fetch: answering() }, one, store.cache)
    expect(await ask(site, look.hour)).not.toBe('busy')
    expect(await ask(site, '2027-05-06T14:00:00Z')).toBe('busy')
    const down = horizonsForTools(dataDir, { fetch: vi.fn<typeof fetch>(async () => new Response('no', { status: 500 })) }, limits(), memoryStore().cache)
    expect(await down(site, look.hour)).toBeNull()
    expect(await down({ ...site, id: 'not-a-site' }, look.hour)).toBeNull()
  })
})
