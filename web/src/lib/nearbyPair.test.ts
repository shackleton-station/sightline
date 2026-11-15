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

  it('on its date a short stay is sunlit throughout at one and dark for 71 h at the other', async () => {
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
    expect(Math.round(b.sunPct ?? 0)).toBe(68)
    expect(b.sunGapH).toBe(71)
    expect(b.problems.length).toBeGreaterThan(0)
  })
})
