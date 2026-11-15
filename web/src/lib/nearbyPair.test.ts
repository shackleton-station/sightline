import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteData } from '../../shared/tools/data'
import { hourOf } from './mission'
import { NEARBY_PAIR, nearbyPairKm } from './nearbyPair'
import { DEFAULT_MISSION, measureScenario } from './sightlineMission'

// Against the pipeline's real output: the example is only true while these figures hold.
const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))

describe('the ready comparison of two nearby sites', () => {
  it('is two sites of the same group, 10 km apart', async () => {
    const sites = await data.sites()
    const a = sites.find((site) => site.id === NEARBY_PAIR.a)!
    const b = sites.find((site) => site.id === NEARBY_PAIR.b)!
    expect(a.group).toBe(b.group)
    expect(nearbyPairKm(sites)).toBe(10)
    expect(nearbyPairKm(sites.filter((site) => site.id !== NEARBY_PAIR.b))).toBeNull()
  })

  it('on its date a short stay fits at one, sunlit throughout, and at the other is dark for 57 h and out of contact for 32 h', async () => {
    const sites = await data.sites()
    const measure = async (id: string) => {
      const site = sites.find((one) => one.id === id)!
      const flags = await data.flags(id)
      return measureScenario({ site: id, landing: hourOf(flags.start, NEARBY_PAIR.landing) }, site, flags, DEFAULT_MISSION, site.slope?.deg ?? null)
    }
    const a = await measure(NEARBY_PAIR.a)
    const b = await measure(NEARBY_PAIR.b)
    expect(a.sunPct).toBe(100)
    expect(a.sunGapH).toBe(0)
    expect(a.problems).toEqual([])
    expect(a.earthGapH).toBe(14)
    expect(Math.round(b.sunPct ?? 0)).toBe(83)
    expect(b.sunGapH).toBe(57)
    expect(b.earthGapH).toBe(32)
    expect(b.problems).toEqual(['The Sun is gone for 57 h during the mission; your limit is 24 h.', 'Earth is gone for 32 h during the mission; your limit is 24 h.'])
  })
})
