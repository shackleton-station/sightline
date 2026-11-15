import { describe, expect, it } from 'vitest'
import type { Validation } from '../data/contract'
import { siteTolerance } from './compare'
import { bestByPair, pairTie, SHARE_TIE, shareTies, type TieSide, VALIDATION_HEIGHT_M } from './starTie'

interface Reads {
  /** NASA's map at the site: Sun and Earth, in percent; null where no map reaches. */
  map: [number, number] | null
  /** The model at the site, at 2 m. */
  ours: [number, number]
}

/** A validation file with rows at 0 m and 2 m only, as the real ones have: RMSE 4 for the Sun and 3 for Earth. */
function validation({ map, ours }: Reads): Validation {
  const stats = (quantity: string, rmse: number, obs_height_m: number) => ({ quantity, obs_height_m, sample: 'all', n: 80, bias: 0, median: 0, mae: 0, rmse, r: 1 })
  return {
    pgda: {
      map: map ? { sun_pct: map[0], earth_pct: map[1] } : null,
      ours: [
        { obs_height_m: 0, sun_any_pct: ours[0] - 1, earth_any_pct: ours[1] - 1 },
        { obs_height_m: 2, sun_any_pct: ours[0], earth_any_pct: ours[1] },
      ],
      grid: { stats: [stats('sun_any_pct', 9, 0), stats('earth_any_pct', 9, 0), stats('sun_any_pct', 4, 2), stats('earth_any_pct', 3, 2)] },
    },
  } as unknown as Validation
}

/** The model reads 6 points above NASA's Sun map here, and 1 above its Earth map. */
const ridge: TieSide = { site: 'ridge', siteId: 'ridge', validation: validation({ map: [70, 50], ours: [76, 51] }) }
/** Here it agrees with both maps. */
const rim: TieSide = { site: 'rim', siteId: 'rim', validation: validation({ map: [60, 50], ours: [60, 50] }) }
/** A site NASA's polar maps do not reach. */
const equator: TieSide = { site: 'equator', siteId: 'equator', validation: validation({ map: null, ours: [50, 100] }) }
const custom: TieSide = { site: '-88.5,40', siteId: null, validation: undefined }

describe('pairTie', () => {
  it('keeps half a point between two dates at the same site', () => {
    expect(pairTie(ridge, ridge, 'sun')).toBe(SHARE_TIE)
    expect(pairTie(custom, { ...custom }, 'both')).toBe(SHARE_TIE)
  })

  it('takes the measured-error tolerance between two different sites: the error, or how differently the model reads at them', () => {
    // Sun: RMSE 4, and the model reads 6 points apart at the two sites.
    expect(pairTie(ridge, rim, 'sun')).toBe(6)
    // Earth: RMSE 3, and 1 point apart.
    expect(pairTie(ridge, rim, 'earth')).toBe(3)
    // The two together: the larger of the two.
    expect(pairTie(ridge, rim, 'both')).toBe(6)
    expect(pairTie(rim, ridge, 'sun')).toBe(6)
  })

  it('never goes under half a point', () => {
    const exact = (site: string): TieSide => ({ site, siteId: site, validation: { pgda: { map: null, ours: [{ obs_height_m: 2, sun_any_pct: 50, earth_any_pct: 50 }], grid: { stats: [{ quantity: 'sun_any_pct', obs_height_m: 2, sample: 'all', rmse: 0.1 }] } } } as unknown as Validation })
    expect(pairTie(exact('a'), exact('b'), 'sun')).toBe(SHARE_TIE)
  })

  it('counts a site with no NASA map as reading the same as the map: the other site\'s difference is the gap', () => {
    expect(pairTie(ridge, equator, 'sun')).toBe(6)
    expect(pairTie(rim, equator, 'sun')).toBe(4)
  })

  it('reads the 2 m rows whatever the mission\'s heights: the files have no others, and it never throws', () => {
    expect(VALIDATION_HEIGHT_M).toBe(2)
    // A 5 m panel has no rows of its own: asked for directly, the tolerance is not known, and nothing is thrown.
    expect(siteTolerance({ siteId: 'ridge', validation: ridge.validation ?? null, obsHeightM: 5 }, { siteId: 'rim', validation: rim.validation ?? null, obsHeightM: 5 }, 'sun_any_pct')).toBeNull()
    // The rule itself asks at 2 m, so it has an answer.
    expect(pairTie(ridge, rim, 'sun')).toBe(6)
  })

  it('leaves a pair with a custom point on half a point', () => {
    expect(pairTie(ridge, custom, 'sun')).toBe(SHARE_TIE)
    expect(pairTie(custom, rim, 'both')).toBe(SHARE_TIE)
  })

  it('is not known until both sites\' files have arrived, or when a file lacks the rows', () => {
    expect(pairTie(ridge, { ...rim, validation: undefined }, 'sun')).toBeNull()
    expect(pairTie({ ...ridge, validation: null }, rim, 'earth')).toBeNull()
    const empty = { checks: [], max_diff_deg: 0 } as unknown as Validation
    expect(pairTie(ridge, { ...rim, validation: empty }, 'sun')).toBeNull()
    const noRows = { pgda: { map: null, ours: [], grid: { stats: [] } } } as unknown as Validation
    expect(pairTie(ridge, { ...rim, validation: noRows }, 'both')).toBeNull()
  })
})

describe('bestByPair', () => {
  const ties = (sides: TieSide[], quantity: 'sun' | 'earth' | 'both' = 'sun') => {
    const of = shareTies(sides)
    return (i: number, j: number) => of(quantity, i, j)
  }

  it('gives no star to two different sites whose gap is inside the tolerance, and says the rule did it', () => {
    expect(bestByPair([80, 78], 'high', ties([ridge, rim]))).toEqual({ best: [false, false], tooClose: true })
    expect(bestByPair([74, 80], 'high', ties([ridge, rim]))).toEqual({ best: [false, false], tooClose: true })
  })

  it('stars the better of two different sites beyond the tolerance', () => {
    expect(bestByPair([80, 73], 'high', ties([ridge, rim]))).toEqual({ best: [true, false], tooClose: false })
    expect(bestByPair([60, 73], 'high', ties([ridge, rim]))).toEqual({ best: [false, true], tooClose: false })
  })

  it('keeps the star for the same site on two dates 2.1 points apart', () => {
    expect(bestByPair([80, 77.9], 'high', ties([ridge, ridge]))).toEqual({ best: [true, false], tooClose: false })
  })

  it('shares or withholds pair by pair with three scenarios', () => {
    // The best is the ridge on its first date. Its second date is 3 points behind (same site: no star);
    // the rim is 2 behind (another site, inside the tolerance of 6: it shares the star).
    expect(bestByPair([80, 77, 78], 'high', ties([ridge, ridge, rim]))).toEqual({ best: [true, false, true], tooClose: true })
    // With the rim 10 behind, only the leader keeps it.
    expect(bestByPair([80, 77, 70], 'high', ties([ridge, ridge, rim]))).toEqual({ best: [true, false, false], tooClose: false })
    // All three within their ties of the best: every scenario shares, so none is shown.
    expect(bestByPair([80, 79.8, 78], 'high', ties([ridge, ridge, rim]))).toEqual({ best: [false, false, false], tooClose: true })
  })

  it('leaves out a scenario not worked out yet', () => {
    expect(bestByPair([80, null, 70], 'high', ties([ridge, rim, rim]))).toEqual({ best: [true, false, false], tooClose: false })
    expect(bestByPair([80, null], 'high', ties([ridge, rim]))).toEqual({ best: [false, false], tooClose: false })
    expect(bestByPair([null, null], 'high', ties([ridge, rim]))).toEqual({ best: [false, false], tooClose: false })
  })

  it('shows no star while a site\'s file has not arrived, and does not blame the rule for it', () => {
    const waiting = { ...rim, validation: undefined }
    expect(bestByPair([80, 60], 'high', ties([ridge, waiting]))).toEqual({ best: [false, false], tooClose: false })
    expect(bestByPair([80, 77, 60], 'high', ties([ridge, ridge, waiting]))).toEqual({ best: [false, false, false], tooClose: false })
  })

  it('uses the larger of the Sun\'s and Earth\'s tolerances for the two together', () => {
    // 5 points apart: beyond Earth's 3, inside the Sun's 6.
    expect(bestByPair([80, 75], 'high', ties([ridge, rim], 'earth')).best).toEqual([true, false])
    expect(bestByPair([80, 75], 'high', ties([ridge, rim], 'both')).best).toEqual([false, false])
  })

  it('keeps half a point against a custom point', () => {
    expect(bestByPair([80, 78], 'high', ties([ridge, custom]))).toEqual({ best: [true, false], tooClose: false })
  })

  it('handles a site with no NASA map', () => {
    // The equator site and the rim: tolerance 4 (the error alone).
    expect(bestByPair([50, 47], 'high', ties([equator, rim]))).toEqual({ best: [false, false], tooClose: true })
    expect(bestByPair([50, 45], 'high', ties([equator, rim]))).toEqual({ best: [true, false], tooClose: false })
  })
})
