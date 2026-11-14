import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlansApp, STATUS_PATH } from '../plans/app'
import { memoryPlans } from '../plans/store'
import { dataDir, ORIGIN } from '../plans/testing'
import { DRILL_RETRY_AFTER_S, region, unavailableDrill } from './region'

const site = (env: NodeJS.ProcessEnv) => {
  const app = new Hono()
  app.use(unavailableDrill(env))
  app.get('/', (c) => c.text('the page'))
  return app
}

const plansService = () => createPlansApp({ dataDir, allowedOrigins: [], plans: memoryPlans(), version: 'abc1234', dataVersion: 'da7a', revision: 'clps-plans-00001-abc' })

describe('the region a copy reports', () => {
  it('is the REGION setting, or null when it is not set (a laptop)', () => {
    expect(region({ REGION: 'us-central1' })).toBe('us-central1')
    expect(region({})).toBeNull()
    expect(region({ REGION: '' })).toBeNull()
  })
})

describe('the failover drill (DRILL_UNAVAILABLE)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('lets every request through when it is off, or set to anything but "on"', async () => {
    for (const env of [{}, { DRILL_UNAVAILABLE: 'off' }, { DRILL_UNAVAILABLE: '1' }]) {
      const answer = await site(env).request('/')
      expect(answer.status).toBe(200)
      expect(await answer.text()).toBe('the page')
    }
  })

  it('answers 503, which outlier detection counts, with Retry-After and the region, when it is on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answer = await site({ DRILL_UNAVAILABLE: 'on', REGION: 'us-east4' }).request('/')
    expect(answer.status).toBe(503)
    expect(answer.headers.get('retry-after')).toBe(String(DRILL_RETRY_AFTER_S))
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toMatchObject({ drill: 'unavailable', region: 'us-east4' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('in us-east4'))
  })

  it('switches a whole service off, its status address included, before any store or limit is touched', async () => {
    vi.stubEnv('DRILL_UNAVAILABLE', 'on')
    vi.stubEnv('REGION', 'us-central1')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plans = memoryPlans()
    const get = vi.spyOn(plans, 'get')
    const app = createPlansApp({ dataDir, allowedOrigins: [], plans, version: 'abc1234', dataVersion: 'da7a', revision: 'clps-plans-00001-abc' })
    const status = await app.request(`${ORIGIN}${STATUS_PATH}`)
    expect(status.status).toBe(503)
    expect(await status.json()).toMatchObject({ region: 'us-central1' })
    expect((await app.request(`${ORIGIN}/api/plans/zzzzzzz2`)).status).toBe(503)
    expect(get).not.toHaveBeenCalled()
  })

  it('leaves the status working, with the region in it, when it is off', async () => {
    vi.stubEnv('REGION', 'us-central1')
    const status = await plansService().request(`${ORIGIN}${STATUS_PATH}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ region: 'us-central1' })
  })
})
