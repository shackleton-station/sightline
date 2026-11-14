import { describe, expect, it } from 'vitest'
import { CANARY_HEADER, canaryFrom, canaryHeaders, waitForRevision, watchTargets, withCanary } from './canary-header.mjs'

const SITE = 'https://lunarsightline.com'

/** A fetch that records what it was asked and answers with `answer(url, init)`. */
function recorder(answer = () => new Response('{}')) {
  const calls = []
  const fetchFn = async (input, init = {}) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init.headers) })
    return answer(String(input), init)
  }
  return { calls, fetchFn }
}

describe('canaryFrom', () => {
  it('reads the service after --canary', () => {
    expect(canaryFrom(['node', 'smoke.mjs', SITE, '--canary', 'web'])).toBe('web')
    expect(canaryFrom(['node', 'plans-check.mjs', SITE, '--cloud', '--canary', 'plans', '--save'])).toBe('plans')
  })

  it('is null when there is no --canary', () => {
    expect(canaryFrom(['node', 'smoke.mjs', SITE, '--plans-service'])).toBeNull()
  })

  it('refuses a service the load balancer has no canary for, or none at all', () => {
    expect(() => canaryFrom(['node', 'x', SITE, '--canary', 'events-worker'])).toThrow(/web, plans, copilot/)
    expect(() => canaryFrom(['node', 'x', SITE, '--canary'])).toThrow(/got nothing/)
  })
})

describe('canaryHeaders', () => {
  it('is the one plain header, or nothing for the live version', () => {
    expect(canaryHeaders('copilot')).toEqual({ 'x-clps-canary': 'copilot' })
    expect(canaryHeaders(null)).toEqual({})
    expect(CANARY_HEADER).toBe('x-clps-canary')
  })
})

describe('withCanary', () => {
  it('adds the header to requests for the site, and keeps the headers the caller set', async () => {
    const { calls, fetchFn } = recorder()
    const wrapped = withCanary(fetchFn, SITE, 'plans')
    await wrapped(`${SITE}/api/plans/status`)
    await wrapped(`${SITE}/api/plans`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' } })
    expect(calls[0].headers.get('x-clps-canary')).toBe('plans')
    expect(calls[1].headers.get('x-clps-canary')).toBe('plans')
    expect(calls[1].headers.get('origin')).toBe(SITE)
    expect(calls[1].headers.get('content-type')).toBe('application/json')
  })

  it('leaves requests to any other address alone', async () => {
    const { calls, fetchFn } = recorder()
    await withCanary(fetchFn, SITE, 'web')('https://evil.example/x', { headers: { a: '1' } })
    expect(calls[0].headers.get('x-clps-canary')).toBeNull()
    expect(calls[0].headers.get('a')).toBe('1')
  })

  it('takes the headers of a Request when no init is given', async () => {
    const { calls, fetchFn } = recorder()
    await withCanary(fetchFn, SITE, 'web')(new Request(`${SITE}/`, { headers: { range: 'bytes=0-1' } }))
    expect(calls[0].headers.get('range')).toBe('bytes=0-1')
    expect(calls[0].headers.get('x-clps-canary')).toBe('web')
  })

  it('is the plain fetch with no service', () => {
    const { fetchFn } = recorder()
    expect(withCanary(fetchFn, SITE, null)).toBe(fetchFn)
  })
})

describe('waitForRevision', () => {
  /** A clock that moves only when the wait sleeps. */
  function clock() {
    let t = 0
    return { now: () => t, sleep: async (ms) => void (t += ms) }
  }

  it('returns as soon as the status names the new revision, sending the header each time', async () => {
    const answers = ['clps-web-00084-old', 'clps-web-00084-old', 'clps-web-00085-new']
    const { calls, fetchFn } = recorder(() => Response.json({ revision: answers.shift() }))
    const result = await waitForRevision({ url: `${SITE}/api/status`, headers: { 'x-clps-canary': 'web' }, revision: 'clps-web-00085-new', fetchFn, ...clock() })
    expect(result).toEqual({ ok: true, tries: 3, last: 'clps-web-00085-new' })
    expect(calls.every((call) => call.headers.get('x-clps-canary') === 'web')).toBe(true)
  })

  it('gives up after the time allowed, and says what it last saw', async () => {
    const { fetchFn } = recorder(() => Response.json({ revision: 'clps-web-00084-old' }))
    const result = await waitForRevision({ url: `${SITE}/api/status`, revision: 'clps-web-00085-new', seconds: 20, everyMs: 5000, fetchFn, ...clock() })
    expect(result.ok).toBe(false)
    expect(result.tries).toBe(5)
    expect(result.last).toBe('clps-web-00084-old')
  })

  it('keeps asking through errors and answers with no revision', async () => {
    let n = 0
    const fetchFn = async () => {
      n++
      if (n === 1) throw new Error('connection reset')
      if (n === 2) return new Response('<html>', { status: 503 })
      return Response.json({ revision: 'r2' })
    }
    const result = await waitForRevision({ url: `${SITE}/api/status`, revision: 'r2', fetchFn, ...clock() })
    expect(result).toEqual({ ok: true, tries: 3, last: 'r2' })
  })
})

describe('watchTargets', () => {
  it('watches the site twice through the load balancer: live with no header, new with it', () => {
    expect(watchTargets(['node', 'canary.mjs', SITE, `${SITE}/`, '--canary', 'copilot', '--seconds', '60'])).toEqual([
      { name: 'live', base: SITE, headers: {} },
      { name: 'new (x-clps-canary: copilot)', base: SITE, headers: { 'x-clps-canary': 'copilot' } },
    ])
  })

  it('still takes two addresses with no header', () => {
    expect(watchTargets(['node', 'canary.mjs', 'http://localhost:8080', 'http://localhost:8081'])?.map((t) => [t.base, t.headers])).toEqual([
      ['http://localhost:8080', {}],
      ['http://localhost:8081', {}],
    ])
  })

  it('is null without two addresses', () => {
    expect(watchTargets(['node', 'canary.mjs', SITE])).toBeNull()
    expect(watchTargets(['node', 'canary.mjs', SITE, '--canary', 'web'])).toBeNull()
  })
})
