import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { metadataIdTokens, type ServiceTarget, serviceStatuses } from './services'

const targets: ServiceTarget[] = [
  { name: 'plans', url: 'https://clps-plans-x.run.app', statusPath: '/api/plans/status', webPath: '/api/plans/status/web', audience: 'clps-plans' },
  { name: 'copilot', url: 'https://clps-copilot-x.run.app/', statusPath: '/api/chat/status', webPath: '/api/chat/status/web', audience: 'clps-copilot' },
]

/** A fetch that answers per address, or never answers (until the request is given up on). */
function network(answers: Record<string, () => Response | 'hang'>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const answer = answers[String(url)]?.() ?? new Response('nothing here', { status: 404 })
    if (answer !== 'hang') return answer
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))))
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('how the other services are', () => {
  it('asks each on the path meant for the web server, with a token made for that service', async () => {
    const fetcher = network({
      'https://clps-plans-x.run.app/api/plans/status/web': () => Response.json({ service: 'plans', version: 'p1' }),
      'https://clps-copilot-x.run.app/api/chat/status/web': () => Response.json({ service: 'copilot', breaker: { state: 'closed' } }),
    })
    const idTokens = vi.fn(async (audience: string) => `token-for-${audience}`)
    const { services } = await serviceStatuses(targets, idTokens, Date.now, fetcher).check()
    expect(services.plans).toMatchObject({ state: 'up', checkedAs: 'web', status: { service: 'plans' } })
    expect(services.copilot).toMatchObject({ state: 'up', checkedAs: 'web', status: { breaker: { state: 'closed' } } })
    expect(idTokens.mock.calls.map(([audience]) => audience)).toEqual(['clps-plans', 'clps-copilot'])
    const sent = fetcher.mock.calls.map(([url, init]) => [String(url), new Headers((init as RequestInit).headers).get('authorization')])
    expect(sent).toEqual([
      ['https://clps-plans-x.run.app/api/plans/status/web', 'Bearer token-for-clps-plans'],
      ['https://clps-copilot-x.run.app/api/chat/status/web', 'Bearer token-for-clps-copilot'],
    ])
  })

  it('reports a service that does not answer within 1 s as down, and the other as up', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = network({
        'https://clps-plans-x.run.app/api/plans/status': () => Response.json({ service: 'plans' }),
        'https://clps-copilot-x.run.app/api/chat/status': () => 'hang',
      })
      const checking = serviceStatuses(targets, null, Date.now, fetcher).check()
      await vi.advanceTimersByTimeAsync(1001)
      const { services } = await checking
      expect(services.plans).toMatchObject({ state: 'up', checkedAs: 'anyone' })
      expect(services.copilot).toMatchObject({ state: 'down', why: 'no answer within 1 s' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an error answer as down, a service with no address as not asked, and a token it cannot get as down', async () => {
    const fetcher = network({ 'https://clps-plans-x.run.app/api/plans/status/web': () => Response.json({ error: 'caller' }, { status: 401 }) })
    const { services } = await serviceStatuses([targets[0], { ...targets[1], url: null }], async () => 'token', Date.now, fetcher).check()
    expect(services.plans).toMatchObject({ state: 'down', why: 'answered HTTP 401 (caller)' })
    expect(services.copilot).toEqual({ state: 'not-asked', why: 'this server was not told its address' })
    const noToken = await serviceStatuses([targets[0]], async () => Promise.reject(new Error('metadata server: HTTP 404')), Date.now, fetcher).check()
    expect(noToken.services.plans).toMatchObject({ state: 'down', why: 'could not be reached: metadata server: HTTP 404' })
  })

  it('reuses an answer for 10 s, so a busy page cannot wake the services over and over', async () => {
    let time = 0
    const fetcher = network({ 'https://clps-plans-x.run.app/api/plans/status': () => Response.json({}) })
    const statuses = serviceStatuses([targets[0]], null, () => time, fetcher)
    await statuses.check()
    time = 9_000
    await statuses.check()
    expect(fetcher).toHaveBeenCalledTimes(1)
    time = 10_000
    await statuses.check()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('is served at /api/status/services, and /api/status itself asks nobody', async () => {
    const check = vi.fn(async () => ({ checkedAt: '2026-11-12T12:00:00.000Z', services: { copilot: { state: 'not-asked' as const, why: 'x' } } }))
    const app = createApp({ distDir: '/nonexistent', bucket: null, allowedOrigins: [], services: { check } })
    expect(await (await app.request('https://site.example/api/status/services')).json()).toEqual({ checkedAt: '2026-11-12T12:00:00.000Z', services: { copilot: { state: 'not-asked', why: 'x' } } })
    await app.request('https://site.example/api/status')
    expect(check).toHaveBeenCalledTimes(1)
    const none = createApp({ distDir: '/nonexistent', bucket: null, allowedOrigins: [] })
    expect(((await (await none.request('https://site.example/api/status/services')).json()) as { services: object }).services).toEqual({})
  })
})

describe('identity tokens from the metadata server', () => {
  it('asks for the audience given, and keeps each token until five minutes before it expires', async () => {
    let time = 0
    const exp = 3600
    const jwt = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`
    const fetcher = vi.fn(async () => new Response(jwt)) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const tokens = metadataIdTokens(fetcher, () => time)
    expect(await tokens('clps-copilot')).toBe(jwt)
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=clps-copilot&format=full')
    expect(new Headers(init.headers).get('metadata-flavor')).toBe('Google')
    time = (exp - 301) * 1000
    await tokens('clps-copilot')
    expect(fetcher).toHaveBeenCalledTimes(1)
    time = (exp - 300) * 1000
    await tokens('clps-copilot')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
