import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteData } from '../../shared/tools/data'
import type { SiteFlags } from './flags'
import { hourOf } from './mission'
import { DEFAULT_MISSION, fitProblems, nearestFittingSite } from './sightlineMission'

// Against the pipeline's real output: the sites, their groups and their hourly flags, as the page has them.
const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))
const everySite = async () => {
  const sites = await data.sites()
  return Promise.all(sites.map(async (site) => ({ site, flags: await data.flags(site.id) })))
}

describe('another site for the same landing (the verdict\'s "Fits at … on this date")', () => {
  it('is the nearest site of the same group where the verdict\'s own rules pass on that date', async () => {
    const listed = await everySite()
    const ridge = listed.find((entry) => entry.site.id === 'connecting-ridge')!
    const landing = hourOf(ridge.flags.start, '2027-04-30T00:00:00Z')
    // The landing does not fit here, and of the other three ridge sites only one fits on this date.
    expect(fitProblems(ridge.flags, landing, DEFAULT_MISSION, ridge.site.slope?.deg ?? null).length).toBeGreaterThan(0)
    const found = nearestFittingSite(ridge.site, landing, DEFAULT_MISSION, listed)
    expect(found?.site.name).toBe('Peak near Shackleton')
    expect(found?.km.toFixed(1)).toBe('42.1')
    const there = listed.find((entry) => entry.site.id === found?.site.id)!
    expect(fitProblems(there.flags, landing, DEFAULT_MISSION, there.site.slope?.deg ?? null)).toEqual([])
  })

  it('is nothing when the date fits at no site of the group', async () => {
    const listed = await everySite()
    const ridge = listed.find((entry) => entry.site.id === 'connecting-ridge')!
    expect(nearestFittingSite(ridge.site, hourOf(ridge.flags.start, '2027-05-06T13:00:00Z'), DEFAULT_MISSION, listed)).toBeNull()
  })

  it('never leaves the group, and never offers a site whose ground is too steep', async () => {
    const listed = await everySite()
    // Sun and Earth always up everywhere: only the group and the slope are left to decide.
    const always = listed.map((entry) => ({ site: entry.site, flags: { ...entry.flags, sun: entry.flags.sun.map(() => true), earth: entry.flags.earth.map(() => true), earthAbove: {} } as SiteFlags }))
    const ridge = always.find((entry) => entry.site.id === 'connecting-ridge')!
    // The nearest ridge site of the three others.
    expect(nearestFittingSite(ridge.site, 0, DEFAULT_MISSION, always)?.site.id).toBe('shackleton-rim')
    // With a 5° limit Shackleton Rim (5.1°) is out: the next nearest takes its place.
    expect(nearestFittingSite(ridge.site, 0, { ...DEFAULT_MISSION, maxSlopeDeg: 5 }, always)?.site.id).toBe('de-gerlache-rim')
    // A point of the visitor's own belongs to no group of listed sites.
    expect(nearestFittingSite({ ...ridge.site, id: 'custom', group: 'Custom point' }, 0, DEFAULT_MISSION, always)).toBeNull()
    const apollo = always.find((entry) => entry.site.id === 'apollo-11')!
    expect(['apollo-15', 'apollo-17']).toContain(nearestFittingSite(apollo.site, 0, DEFAULT_MISSION, always)?.site.id)
  })
})
