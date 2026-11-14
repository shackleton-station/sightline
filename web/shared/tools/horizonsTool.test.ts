import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { siteData } from './data'
import { DEFAULT_LIMITS } from './defaults'
import { azimuthGapDeg, type HorizonsAsk } from './horizonsTool'
import { runTool, toolDeclarations } from './tools'

const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))
const context = { data, requirements: DEFAULT_LIMITS }
const HOUR = '2027-05-09T08'

/** The app's own numbers for the hour, read the way the tool reads them. */
async function ours() {
  return (await data.scenario('connecting-ridge', '2027-05')).track[8 * 24 + 8]
}

describe('horizons_check, Scout’s way to check an hour with NASA JPL Horizons', () => {
  it('sets Horizons’ four angles beside the app’s own for a listed site and hour', async () => {
    const mine = await ours()
    expect(mine.t).toBe('2027-05-09T08:00:00Z')
    const horizons = vi.fn<HorizonsAsk>(async () => ({
      sun: { azDeg: mine.sun_az + 0.004, elDeg: mine.sun_el - 0.003 },
      earth: { azDeg: mine.earth_az, elDeg: mine.earth_el + 0.02 },
      ephemeris: 'DE441',
      altKm: 1.958,
    }))
    const result = await runTool('horizons_check', { site: 'connecting-ridge', time: HOUR }, { ...context, horizons })
    if (!result.ok) throw new Error(result.error)
    const value = (key: string) => result.facts.find((found) => found.key === key)?.value
    const deg = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}°`

    expect(horizons).toHaveBeenCalledWith(expect.objectContaining({ id: 'connecting-ridge' }), '2027-05-09T08:00:00Z')
    expect(value('sun_elevation_ours')).toBe(deg(mine.sun_el))
    expect(value('earth_azimuth_ours')).toBe(deg(mine.earth_az))
    expect(value('earth_elevation_nasa')).toBe(deg(Math.round((mine.earth_el + 0.02) * 100) / 100))
    expect(value('largest_difference')).toBe('0.02°')
    expect(value('ephemeris')).toBe('DE441')
    expect(value('height')).toBe('1.958 km')
  })

  it('says so, in words the model can pass on, when Horizons is busy, silent or out of reach', async () => {
    const args = { site: 'connecting-ridge', time: HOUR }
    const busy = await runTool('horizons_check', args, { ...context, horizons: async () => 'busy' })
    expect(busy).toEqual({ ok: false, error: expect.stringMatching(/too often/) })
    const silent = await runTool('horizons_check', args, { ...context, horizons: async () => null })
    expect(silent).toEqual({ ok: false, error: expect.stringMatching(/did not answer/) })
    const none = await runTool('horizons_check', args, context)
    expect(none).toEqual({ ok: false, error: expect.stringMatching(/cannot be asked/) })
  })

  it('asks nothing of Horizons for a site or an hour the app has no data for', async () => {
    const horizons = vi.fn<HorizonsAsk>(async () => null)
    expect((await runTool('horizons_check', { site: 'tycho', time: HOUR }, { ...context, horizons })).ok).toBe(false)
    expect((await runTool('horizons_check', { site: 'connecting-ridge', time: '1999-01-01T00' }, { ...context, horizons })).ok).toBe(false)
    expect(horizons).not.toHaveBeenCalled()
  })

  it('is declared to the model with a site and a time, both required', async () => {
    const declared = toolDeclarations(['connecting-ridge']).find((tool) => tool.name === 'horizons_check')
    expect(declared?.input_schema.required).toEqual(['site', 'time'])
  })

  it('measures azimuth gaps the short way round', () => {
    expect(azimuthGapDeg(359.99, 0.01)).toBeCloseTo(0.02, 6)
    expect(azimuthGapDeg(10, 12.5)).toBeCloseTo(2.5, 6)
  })
})
