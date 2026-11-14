import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteData } from './data'
import { DEFAULT_LIMITS } from './defaults'
import { runTool } from './tools'

// Runs against the pipeline's real output, as the co-pilot does.
const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))
const context = { data, requirements: DEFAULT_LIMITS }

describe('conditions_at', () => {
  it("gives the Sun's and Earth's two angles under the app's two names: above the skyline, and elevation", async () => {
    // Connecting Ridge at 00:00 UTC on 7 May 2027: the Sun is below a level horizon and in view over the skyline.
    const result = await runTool('conditions_at', { site: 'connecting-ridge', time: '2027-05-07T00' }, context)
    if (!result.ok) throw new Error('the tool failed')
    const fact = (key: string) => result.facts.find((item) => item.key === key)
    expect(fact('sun')?.value).toBe('up')
    expect(fact('sun_above_skyline')?.label).toMatch(/^Sun above the skyline/)
    expect(fact('sun_above_skyline')?.value).toBe('0.6°')
    expect(fact('sun_height')?.label).toBe('Sun elevation (from a level horizon)')
    expect(fact('sun_height')?.value).toBe('−1.2°')
    expect(fact('earth_above_skyline')?.value).toBe('7.8°')
    expect(fact('earth_height')?.value).toBe('5.9°')
    expect(fact('earth')?.value).toBe('in view')
    // No label uses "height" or "level horizon" for the figure that decides visibility.
    expect(result.facts.some((item) => /above the level horizon|the ridge/.test(item.label))).toBe(false)
  })

  it('says Earth is partly in view when the skyline hides part of its disc, as it does for the Sun', async () => {
    // Connecting Ridge at 12:00 UTC on 25 May 2027: Earth's centre is 0.9° below the skyline and its upper edge still clears it.
    const result = await runTool('conditions_at', { site: 'connecting-ridge', time: '2027-05-25T12' }, context)
    if (!result.ok) throw new Error('the tool failed')
    const fact = (key: string) => result.facts.find((item) => item.key === key)
    expect(fact('earth_above_skyline')?.value).toBe('−0.9°')
    expect(fact('earth')?.value).toMatch(/^partly in view: only its upper edge shows over the skyline/)
    expect(fact('headline')?.value).toMatch(/Earth is partly in view/)
  })
})
