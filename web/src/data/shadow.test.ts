import { describe, expect, it } from 'vitest'
import { dataFile } from '../lib/testData'
import type { ShadowAnswer, ShadowDistances, SiteInfo } from './contract'

describe('shadow.json, the distance to permanently shadowed ground', () => {
  const shadow = dataFile<ShadowDistances>('shadow.json')
  const sites = dataFile<SiteInfo[]>('sites.json')
  const answers = (answer: (entry: ShadowDistances['sites'][string]) => ShadowAnswer) => sites.map((site) => ({ site, answer: answer(shadow.sites[site.id]) }))

  it('has an answer of each kind for every listed site, in km, with its source and what the words mean', () => {
    expect(Object.keys(shadow.sites).sort()).toEqual(sites.map((site) => site.id).sort())
    expect(shadow.unit).toBe('km')
    expect(shadow.what).toMatch(/never/)
    expect(shadow.source.url).toMatch(/^https:\/\/pgda\.gsfc\.nasa\.gov\//)
    expect(shadow.region_min_km2).toBe(10)
  })

  it('gives a number only inside the maps, and only how far outside them otherwise', () => {
    for (const { site, answer } of [...answers((entry) => entry.patch), ...answers((entry) => entry.region)]) {
      const inMaps = site.lat <= -shadow.covered_from_lat
      expect(answer.status === 'outside_map').toBe(!inMaps)
      if (answer.status === 'outside_map') expect(answer.map_edge_km).toBeGreaterThan(0)
    }
  })

  it('finds the sizeable region no nearer than the nearest patch, and at least as large as it says', () => {
    for (const site of sites) {
      const { patch, region } = shadow.sites[site.id]
      if (patch.status !== 'found' || region.status !== 'found') continue
      expect(region.distance_km).toBeGreaterThanOrEqual(patch.distance_km)
      expect(region.region_km2).toBeGreaterThanOrEqual(shadow.region_min_km2)
      expect(patch.distance_km).toBeGreaterThan(0)
    }
  })

  it('puts Shackleton Rim a few kilometres from the shadow inside Shackleton crater', () => {
    const { region } = shadow.sites['shackleton-rim']
    expect(region.status).toBe('found')
    if (region.status !== 'found') return
    expect(region.distance_km).toBeGreaterThan(1)
    expect(region.distance_km).toBeLessThan(5)
    // LROC's atlas gives this region 233.7 km².
    expect(region.region_km2).toBeGreaterThan(225)
    expect(region.region_km2).toBeLessThan(242)
  })
})
