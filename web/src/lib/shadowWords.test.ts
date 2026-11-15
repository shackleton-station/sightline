import { describe, expect, it } from 'vitest'
import type { ShadowDistances } from '../data/contract'
import { shadowCell, shadowMeans } from './shadowWords'
import { dataFile } from './testData'

describe("Compare's science row: the distance to permanently shadowed ground", () => {
  const shadow = dataFile<ShadowDistances>('shadow.json')

  it('writes a distance as a bare number, to one decimal under 10 km', () => {
    // Connecting Ridge: 0.1 km to the nearest shadowed pixel in NASA's map.
    expect(shadowCell(shadow.sites['connecting-ridge'].patch)).toEqual({ cell: '0.1', words: '0.1 km', explain: false })
    expect(shadowCell({ status: 'found', distance_km: 39.36, lat: 0, lon: 0, region_km2: 1, map: 'm', pixel_m: 240 })).toEqual({ cell: '39', words: '39 km', explain: false })
  })

  it('says "none" where the maps hold none to measure to, and how far that is known', () => {
    // Apollo 11 lies far outside the polar maps.
    const apollo = shadowCell(shadow.sites['apollo-11'].patch)
    expect(apollo.cell).toBe('none')
    expect(apollo.words).toMatch(/^none mapped within [\d,]+ km$/)
    expect(apollo.explain).toBe(true)
    expect(shadowCell({ status: 'none_within', within_km: 120, map: 'm' }).words).toBe('none mapped within 120 km')
  })

  it('has an answer for every listed site, and the row says what it is and whose map it is from', () => {
    for (const entry of Object.values(shadow.sites)) expect(shadowCell(entry.patch).cell).toMatch(/^([\d.,]+|none)$/)
    expect(shadowMeans(shadow)).toMatch(/never reaches/)
    expect(shadowMeans(shadow)).toMatch(/NASA’s map of permanent shadow \(LOLA; Mazarico et al\. 2011\)/)
  })
})
