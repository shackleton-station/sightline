import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { Bucket, Deps } from './deps'

const ORIGIN = 'https://clps-web.example.run.app'
let distDir: string

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'clps-dist-'))
  mkdirSync(join(distDir, 'assets'))
  mkdirSync(join(distDir, 'data'))
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Navigator</title>')
  mkdirSync(join(distDir, 'scout'))
  writeFileSync(join(distDir, 'scout', 'index.html'), '<!doctype html><title>Scout</title>')
  writeFileSync(join(distDir, 'version.json'), '{"build":"b1"}')
  writeFileSync(join(distDir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(distDir, 'data', 'sites.json'), JSON.stringify({ filler: 'x'.repeat(4000) }))
})
afterAll(() => rmSync(distDir, { recursive: true, force: true }))

function app(overrides: Partial<Deps> = {}) {
  return createApp({ distDir, bucket: null, allowedOrigins: [], ...overrides })
}

describe('built files', () => {
  it('never lets a browser keep the page or version.json', async () => {
    for (const path of ['/', '/index.html', '/version.json']) {
      const response = await app().request(`${ORIGIN}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(await (await app().request(`${ORIGIN}/`)).text()).toContain('Navigator')
  })

  it('serves a second page from its own folder, never cached, and adds the missing slash', async () => {
    const page = await app().request(`${ORIGIN}/scout/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Scout')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const bare = await app().request(`${ORIGIN}/scout`)
    expect(bare.status).toBe(301)
    expect(bare.headers.get('location')).toBe('/scout/')
    expect((await app().request(`${ORIGIN}/assets`)).status).toBe(301)
    expect((await app().request(`${ORIGIN}/assets/`)).status).toBe(404)
  })

  it('lets hashed assets be kept for a year', async () => {
    const response = await app().request(`${ORIGIN}/assets/index-abc123.js`)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-type')).toContain('text/javascript')
  })

  it('makes browsers re-check data files, and answers 304 when unchanged', async () => {
    const first = await app().request(`${ORIGIN}/data/sites.json`)
    expect(first.headers.get('cache-control')).toBe('no-cache')
    const etag = first.headers.get('etag') ?? ''
    expect(etag).not.toBe('')
    const again = await app().request(`${ORIGIN}/data/sites.json`, { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
  })

  it('shrinks JSON for browsers that accept gzip', async () => {
    const response = await app().request(`${ORIGIN}/data/sites.json`, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers.get('content-encoding')).toBe('gzip')
  })

  it('returns 404 for missing files and for paths that try to leave the site folder', async () => {
    expect((await app().request(`${ORIGIN}/nope.json`)).status).toBe(404)
    expect((await app().request(`${ORIGIN}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404)
    expect((await app().request(`${ORIGIN}/%E0%A4%A`)).status).toBe(404)
  })
})

describe('the API', () => {
  it('answers 404 for an unknown API path', async () => {
    expect((await app().request(`${ORIGIN}/api/other`)).status).toBe(404)
  })

  it('reports what this server runs, and where the co-pilot and plans report theirs', async () => {
    expect(await (await app().request(`${ORIGIN}/api/status`)).json()).toEqual({
      limitsAndCache: 'memory',
      redis: { state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 },
      plans: false,
      copilot: false,
      questionLog: false,
      tracing: false,
      voice: false,
      follow: { rooms: 'memory', streams: 0 },
      signIn: null,
      revision: null,
      region: null,
      dataVersion: null,
      counts: false,
      copilotCodeVersion: null,
      elsewhere: { plans: '/api/plans/status', copilot: '/api/chat/status' },
    })
  })

  it('hands the page the sign-in client id, which is all it knows about sign-in', async () => {
    const status = (await (await app({ signInClientId: 'client-id.apps.example' }).request(`${ORIGIN}/api/status`)).json()) as { signIn: string }
    expect(status.signIn).toBe('client-id.apps.example')
  })
})

// The co-pilot and plans are their own services. Their tests are in copilot/ and plans/.
describe("the co-pilot's and plans' paths", () => {
  const PLANS = ['/api/plans', '/api/plans/abcdefgh', '/api/plans/status', '/api/plans/status/web']
  const COPILOT = ['/api/chat', '/api/ask', '/api/chat/status', '/api/chat/status/web']
  const body = JSON.stringify({ question: 'hi', messages: [{ role: 'user', text: 'hi' }], title: 'x', view: '#a=connecting-ridge@2027-05' })
  const ask = (path: string, method: string) => new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' }, body: method === 'GET' ? undefined : body })

  it('are not answered here: 404 for every method, like any path this server does not have', async () => {
    const site = app()
    for (const path of [...PLANS, ...COPILOT]) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const response = await site.request(ask(path, method))
        expect(response.status, `${method} ${path}`).toBe(404)
        expect(await response.json(), `${method} ${path}`).toEqual({ error: 'not-found' })
      }
    }
  })

  it('are 404 whatever else is configured: there is no setting that switches them on', async () => {
    const site = app({ signInClientId: 'client-id.apps.example', traces: { write: () => {} }, trustedProxies: ['10.0.0.1'] })
    expect((await site.request(ask('/api/chat', 'POST'))).status).toBe(404)
    expect((await site.request(ask('/api/ask', 'POST'))).status).toBe(404)
    expect((await site.request(ask('/api/plans', 'POST'))).status).toBe(404)
  })

  describe('on one machine, where there is no load balancer', () => {
    /** Stands in for the two services: answers with what it was asked. */
    const upstream = () =>
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const sent = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : null
        return Response.json({ url: String(input), method: init?.method, origin: new Headers(init?.headers).get('origin'), key: new Headers(init?.headers).get('idempotency-key'), sent }, { status: 201, headers: { 'retry-after': '7' } })
      })
    const forwarding = () => app({ plansUrl: 'http://plans.test:8082/', copilotUrl: 'http://copilot.test:8083' })
    afterEach(() => vi.unstubAllGlobals())

    it('passes each path on to its own service, with the method, the body and the visitor’s headers', async () => {
      const fetcher = upstream()
      vi.stubGlobal('fetch', fetcher)
      const site = forwarding()
      for (const path of PLANS) expect(((await (await site.request(ask(path, 'GET'))).json()) as { url: string }).url).toBe(`http://plans.test:8082${path}`)
      for (const path of COPILOT) expect(((await (await site.request(ask(path, 'GET'))).json()) as { url: string }).url).toBe(`http://copilot.test:8083${path}`)

      const save = ask('/api/plans?x=1', 'POST')
      save.headers.set('idempotency-key', '"abc"')
      const answer = await site.request(save)
      expect(answer.status).toBe(201)
      expect(answer.headers.get('retry-after')).toBe('7')
      expect(await answer.json()).toEqual({ url: 'http://plans.test:8082/api/plans?x=1', method: 'POST', origin: ORIGIN, key: '"abc"', sent: body })
    })

    it('passes on only the service it was told about', async () => {
      const fetcher = upstream()
      vi.stubGlobal('fetch', fetcher)
      const site = app({ plansUrl: 'http://plans.test:8082' })
      expect((await site.request(ask('/api/plans', 'GET'))).status).toBe(201)
      expect((await site.request(ask('/api/chat', 'POST'))).status).toBe(404)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('answers 502 when the service cannot be reached, and never answers for it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED'))))
      const response = await forwarding().request(ask('/api/chat', 'POST'))
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'upstream' })
      vi.restoreAllMocks()
    })
  })
})

describe('files from the bucket', () => {
  const stored = new Map([
    ['tiles/global/16_0.bin.gz', 'tile-bytes'],
    ['tiles/manifest.json', '{"polar":1}'],
    ['tiles/light/2027-05.bin.gz', 'flips'],
    ['tiles/light/wide/2027-05.bin.gz', 'wide flips'],
    ['tiles/light/slope_x.jpg', 'jpeg'],
    ['media/demo.mp4', 'abcdefghij'],
  ])
  const bucket: Bucket = {
    get: async (key, range) => {
      const value = stored.get(key)
      if (value === undefined) return null
      const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null
      const [start, end] = match ? [Number(match[1]), Number(match[2])] : [0, value.length - 1]
      const bytes = value.slice(start, end + 1)
      return {
        status: match ? 206 : 200,
        body: new Response(bytes).body,
        length: String(bytes.length),
        contentRange: match ? `bytes ${start}-${end}/${value.length}` : null,
        etag: '"abc"',
      }
    },
  }
  const get = (path: string, init: RequestInit = {}) => app({ bucket }).request(`${ORIGIN}${path}`, init)

  it('serves a tile as raw bytes, kept for a day, never re-compressed', async () => {
    const response = await get('/tiles/global/16_0.bin.gz', { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('tile-bytes')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(response.headers.get('etag')).toBe('"abc"')
  })

  it('serves the manifest as JSON and answers HEAD without a body', async () => {
    expect((await get('/tiles/manifest.json')).headers.get('content-type')).toBe('application/json')
    const head = await get('/tiles/global/16_0.bin.gz', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it("serves the light grid's months as raw bytes and its slope maps as images", async () => {
    const month = await get('/tiles/light/2027-05.bin.gz', { headers: { 'accept-encoding': 'gzip' } })
    expect(await month.text()).toBe('flips')
    expect(month.headers.get('content-type')).toBe('application/octet-stream')
    expect(month.headers.get('content-encoding')).toBeNull()
    expect((await get('/tiles/light/slope_x.jpg')).headers.get('content-type')).toBe('image/jpeg')
    expect(await (await get('/tiles/light/wide/2027-05.bin.gz')).text()).toBe('wide flips')
    expect((await get('/tiles/light/wider/2027-05.bin.gz')).status).toBe(404)
    expect((await get('/tiles/light/2027-13x.bin.gz')).status).toBe(404)
    expect((await get('/tiles/light/slope_z.jpg')).status).toBe(404)
    expect((await get('/tiles/light/2027-06.bin.gz')).status).toBe(404)
  })

  it('returns 404 for a missing tile or any name the pipeline never writes', async () => {
    expect((await get('/tiles/global/99_99.bin.gz')).status).toBe(404)
    expect((await get('/tiles/global%2F..%2F..%2Fsecret')).status).toBe(404)
    expect((await get('/tiles/global/16_0.bin.gz.bak')).status).toBe(404)
  })

  it('refuses writes, and says so when no bucket is configured', async () => {
    expect((await get('/tiles/global/16_0.bin.gz', { method: 'POST' })).status).toBe(405)
    expect((await app().request(`${ORIGIN}/tiles/manifest.json`)).status).toBe(503)
  })

  it('serves the whole video and says it accepts ranges', async () => {
    const response = await get('/media/demo.mp4')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('abcdefghij')
  })

  it('answers a range request with 206 and the right Content-Range', async () => {
    const response = await get('/media/demo.mp4', { headers: { range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('cdef')
  })

  it('serves only the media files it knows', async () => {
    expect((await get('/media/other.mp4')).status).toBe(404)
    expect((await get('/media/demo.vtt')).status).toBe(404)
  })
})
