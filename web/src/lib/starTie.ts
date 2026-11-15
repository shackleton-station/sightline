import type { Validation } from '../data/contract'
import { type MapQuantity, siteTolerance } from './compare'
import { bestIn } from './sightlineMission'

/**
 * Which scenario earns the star in Compare's three rows that are a share of the mission (sunlit,
 * Earth in view, the two together), when the scenarios are at different sites.
 *
 * Between two dates at the same site, half a point settles it, as before: the model's error at a
 * site is the same on both dates. Between two different sites it does not: the model reads
 * differently from NASA's maps at each site, and that alone can put several points between them.
 * So a lead between two sites counts only beyond the tolerance Classic's comparison already uses
 * (lib/compare.ts): the larger of the error measured against NASA's maps and how differently the
 * model reads at those two sites.
 */

/** Shares of the mission closer than this share the star: half a point, the tie between two dates at one site. */
export const SHARE_TIE = 0.5

/**
 * The height the validation files are read at. They hold results at 0 m and 2 m only, while a
 * mission can put its panel at 2, 5 or 10 m and its antenna at 2, 4 or 10 m. The 2 m rows stand in
 * for every height: a taller mast changes what a site sees, not by how much the model and NASA's
 * maps disagree about the ground round it, and there is no measurement at the other heights to use.
 */
export const VALIDATION_HEIGHT_M = 2

/** The line under a comparison when a star was shared or withheld because two sites are closer than the model's measured error. */
export const TOO_CLOSE_NOTE = "Two sites closer than the model's measured error share the ★ or get none: see How it works."

/** The three rows the rule covers. */
export type ShareQuantity = 'sun' | 'earth' | 'both'

/** What a pair's tie needs to know about one scenario. */
export interface TieSide {
  /** The scenario's own site: a listed site's id, or "lat,lon" for a custom point. Two scenarios at the same place have the same one. */
  site: string
  /** The listed site's id; null for a custom point. */
  siteId: string | null
  /** The listed site's validation file: undefined until it has loaded, null if it could not be read. */
  validation: Validation | null | undefined
}

/** The tie between two scenarios for one row; null while it cannot be known. */
export type ShareTies = (quantity: ShareQuantity, i: number, j: number) => number | null

/**
 * How close two scenarios' shares must be to share the star.
 *
 * - The same site, on two dates: half a point.
 * - Two different listed sites: the larger of half a point and the measured-error tolerance for
 *   that pair, read from their validation files at 2 m. Sun rows use the Sun's figures, Earth rows
 *   Earth's, and the row for the two together the larger of the two.
 * - A pair with a custom point: half a point. A custom point's own error is not on hand on the
 *   Sightline screen (Classic works it out with the point), so the old rule stands for it.
 * - Null while a listed site's file has not arrived, or if it lacks the rows: the caller then shows
 *   no star rather than name a winner it cannot stand behind.
 */
export function pairTie(a: TieSide, b: TieSide, quantity: ShareQuantity): number | null {
  if (a.site === b.site) return SHARE_TIE
  if (a.siteId === null || b.siteId === null) return SHARE_TIE
  if (!a.validation || !b.validation) return null
  const read = (kind: MapQuantity) => siteTolerance({ siteId: a.siteId as string, validation: a.validation ?? null, obsHeightM: VALIDATION_HEIGHT_M }, { siteId: b.siteId as string, validation: b.validation ?? null, obsHeightM: VALIDATION_HEIGHT_M }, kind)
  const sun = quantity === 'earth' ? 0 : read('sun_any_pct')
  const earth = quantity === 'sun' ? 0 : read('earth_any_pct')
  if (sun === null || earth === null) return null
  return Math.max(SHARE_TIE, sun, earth)
}

/** The ties for a list of scenarios, for `bestByPair`. */
export function shareTies(sides: TieSide[]): ShareTies {
  return (quantity, i, j) => pairTie(sides[i], sides[j], quantity)
}

export interface PairMarks {
  /** Which values carry the star. */
  best: boolean[]
  /** True when the measured-error rule changed the row: a star shared with, or withheld from, a site that half a point would have set apart. */
  tooClose: boolean
}

/**
 * Which values in a row are the best, when the tie depends on the pair: a value shares the star
 * with the best value if their gap is within the tie for the two of them. As with `bestIn`, when
 * every scenario shares the star none is shown, so two sites inside the tolerance show no star.
 * While a tie with the best value is not known yet, the row shows no star at all.
 */
export function bestByPair(values: (number | null)[], better: 'high' | 'low', tieOf: (i: number, j: number) => number | null): PairMarks {
  const none = { best: values.map(() => false), tooClose: false }
  const known = values.filter((value): value is number => value !== null)
  if (known.length < 2) return none
  const top = better === 'high' ? Math.max(...known) : Math.min(...known)
  const leaders = values.flatMap((value, i) => (value === top ? [i] : []))
  let unknown = false
  const marks = values.map((value, i) => {
    if (value === null) return false
    if (value === top) return true
    return leaders.some((leader) => {
      const tie = tieOf(i, leader)
      if (tie === null) unknown = true
      return tie !== null && Math.abs(value - top) <= tie
    })
  })
  if (unknown) return none
  // If every scenario shares the best value, marking them all says nothing.
  const best = marks.every(Boolean) ? values.map(() => false) : marks
  const plain = bestIn(values, better, SHARE_TIE)
  return { best, tooClose: plain.some((mark, i) => mark !== best[i]) }
}
