import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import type { FutureTarget } from '../data/futureTargets'
import { siteFor, siteValue, targetAt, targetValue } from './site'

const listed: SiteInfo = { id: 'shackleton-rim', name: 'Shackleton Rim', lat: -89.76, lon: -157.07, source_url: 'https://pgda.gsfc.nasa.gov/products/78', group: 'South pole ridges' }
const mouton: FutureTarget = {
  id: 'mons-mouton',
  name: 'Mons Mouton',
  who: 'CLPS IM-4, Artemis III',
  says: 'The Intuitive Machines Nova-C lander (IM-4) will deliver six NASA CLPS science payloads to Mons Mouton.',
  source_url: 'https://science.nasa.gov/lunar-science/clps-deliveries/cp-22-science/',
  source_date: '2026-06-10',
  feature: 'Mons Mouton',
  feature_url: 'https://planetarynames.wr.usgs.gov/Feature/16070',
  lat: -84.6,
  lon: 31,
}

describe('siteFor', () => {
  it('finds a listed site by its id', () => {
    expect(siteFor([listed], 'shackleton-rim', [mouton])).toBe(listed)
  })

  it('names a custom point as a custom point', () => {
    expect(siteFor([listed], '-88.5,40', [mouton])?.name).toBe('Custom point 88.500°S, 40.000°E')
  })

  it('names a future target for its place, marked approximate, and keeps it a custom point', () => {
    const site = siteFor([listed], targetValue(mouton), [mouton])!
    expect(site.name).toBe('Mons Mouton (approximate)')
    expect(site.source_url).toBe(mouton.source_url)
    expect(site.id).toBe('custom:-84.6,31')
    expect(siteValue(site)).toBe('-84.6,31')
    expect(targetAt([mouton], site)).toBe(mouton)
  })

  it('does not take a listed site or another point for a target', () => {
    expect(targetAt([mouton], listed)).toBeNull()
    expect(targetAt([mouton], siteFor([listed], '-84.6,31.5', [mouton])!)).toBeNull()
  })
})
