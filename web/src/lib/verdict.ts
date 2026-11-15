import type { GridStats, Summary, Validation } from '../data/contract'
import type { CustomQuality } from '../data/scenarioData'

/** A percentage with one decimal, e.g. 39 → "39.0%". */
export function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

/**
 * A share as a whole percent, for prose where a tenth of a percent is more than a reader can use.
 * Never "0%" or "100%" for a share that is not: those read "under 1%" and "over 99%".
 */
export function wholePct(value: number): string {
  const rounded = Math.round(value)
  if (rounded <= 0 && value > 0) return 'under 1%'
  if (rounded >= 100 && value < 100) return 'over 99%'
  return `${rounded}%`
}

/** One-line plain-English result, using only numbers from the pipeline. */
export function verdict(summary: Summary): string {
  return (
    `Sun ${pct(summary.pct_sun)} · Earth ${pct(summary.pct_earth)} · ` +
    `longest Sun gap ${summary.max_sun_gap_h} h`
  )
}

export interface TrustNote {
  text: string
  /** True when this site, at the ground, differs from NASA's map by more than our measured error. */
  warning: boolean
}

export interface ValidationNotes {
  horizons: string
  terrain: string
  earth: TrustNote
  sun: TrustNote
}

/**
 * The height NASA's map is compared at: the ground. PGDA's page gives no height for its maps, and a
 * map of how the terrain is lit is taken to be of the terrain itself, so the like-for-like figure of
 * ours is the run with the observer on the surface, and the part of the disk that counts is any part
 * (the figure the rest of the app shows). The app reads the Sun and Earth from higher up, and that
 * figure is given beside it, never compared with the map.
 */
const MAP_HEIGHT_M = 0

/** What stands at the visitor's height, for the sentence on why the figure is higher there. */
type Raised = { value: number; heightM: number; mast: string } | null

/** "At 2 m up, where this app reads it, our model gives 90%: a panel on a mast sees over the near ground." */
function raisedWords(ground: number, raised: Raised): string {
  if (!raised) return ''
  const gives = ` At ${raised.heightM} m up, where this app reads it, our model gives ${wholePct(raised.value)}`
  return wholePct(raised.value) !== wholePct(ground) && raised.value > ground ? `${gives}: ${raised.mast} on a mast sees over the near ground.` : `${gives}.`
}

/**
 * States whether a long-run value at the ground agrees with NASA's map at this site, judged against
 * the RMSE we measured across many pixels at the ground. A site beyond that error says so rather
 * than claiming validation. The figure at the visitor's own height follows, as a separate sentence.
 */
function compareWithMap(
  name: string,
  ours: number,
  map: number,
  grid: GridStats,
  [low, high]: [number, number],
  raised: Raised,
): TrustNote {
  const difference = Math.abs(ours - map)
  const numbers =
    `${wholePct(ours)} in our model, ${wholePct(map)} on NASA's PGDA map ` +
    `(neighboring pixels ${low.toFixed(0)}–${high.toFixed(0)}%)`
  if (difference <= grid.rmse) {
    return {
      text:
        `${name} at the ground agrees with NASA's map: ${numbers}, inside the ${grid.rmse.toFixed(1)}-point ` +
        `error measured across ${grid.n} other pixels.${raisedWords(ours, raised)}`,
      warning: false,
    }
  }
  return {
    text:
      `${name} at this site is not confirmed, even at the ground: ${numbers}. That's about ` +
      `${difference.toFixed(0)} points apart; across ${grid.n} other pixels the typical difference is ` +
      `${grid.mae.toFixed(1)}.${raisedWords(ours, raised)}`,
    warning: true,
  }
}

/** Plain statements of how far this site's numbers can be trusted, over 18.6 years. */
export function validationNotes(validation: Validation, obsHeightM: number): ValidationNotes {
  const { pgda, horizons } = validation
  const ours = pgda.ours.find((row) => row.obs_height_m === obsHeightM)
  if (!ours) throw new Error(`no validation results for observer height ${obsHeightM} m`)
  const ground = pgda.ours.find((row) => row.obs_height_m === MAP_HEIGHT_M)
  const gridFor = (quantity: string) =>
    pgda.grid.stats.find(
      (row) =>
        row.quantity === quantity && row.obs_height_m === MAP_HEIGHT_M && row.sample === 'all',
    )
  const sunGrid = gridFor('sun_any_pct')
  const earthGrid = gridFor('earth_any_pct')

  const separation = horizons.max_sep_deg < 0.001 ? 'under 0.001' : horizons.max_sep_deg.toFixed(3)
  const unchecked = (name: string): TrustNote => ({
    text: `${name} has no independent check here: NASA's polar maps don't reach this latitude.`,
    warning: false,
  })
  const { map } = pgda
  if (map && (!ground || !sunGrid || !earthGrid)) throw new Error('no validation results at the ground to compare with NASA\'s map')
  // The figure at the visitor's own height, unless that is the ground itself.
  const raised = (value: number, mast: string): Raised => (obsHeightM === MAP_HEIGHT_M ? null : { value, heightM: obsHeightM, mast })
  return {
    horizons: `Sun and Earth positions match JPL Horizons to ${separation}° (${horizons.checks.length} checks).`,
    terrain:
      `Terrain near this site is LOLA at ${validation.terrain_resolution_m.toFixed(0)} m per pixel, ` +
      `so smaller rocks and craters aren't captured.`,
    earth:
      map && ground && earthGrid
        ? compareWithMap('Earth visibility', ground.earth_any_pct, map.earth_pct, earthGrid, map.earth_nearby_pct, raised(ours.earth_any_pct, 'an antenna'))
        : unchecked('Earth visibility'),
    sun:
      map && ground && sunGrid
        ? compareWithMap('Sun', ground.sun_any_pct, map.sun_pct, sunGrid, map.sun_nearby_pct, raised(ours.sun_any_pct, 'a panel'))
        : unchecked('Sun'),
  }
}

/** How far to trust a custom point, from its measured agreement with the full model. */
export function customNotes(custom: CustomQuality): string[] {
  const { accuracy, ridges, resolutionM } = custom
  const sample = ridges ?? accuracy
  const where = ridges
    ? `${ridges.n} well-lit points near the south pole`
    : `${accuracy.n} random points at ${accuracy.min_abs_lat}–${accuracy.max_abs_lat}° latitude`
  return [
    `Computed in your browser from LOLA terrain at ${resolutionM.toFixed(0)} m per pixel near this ` +
      `point, and coarser farther away.`,
    `Tested at ${where} against our full model: Sun differed by ${sample.sun_median_error} points ` +
      `typically and up to ${sample.sun_p90_error} at 90% of points; Earth by ` +
      `${sample.earth_median_error} and up to ${sample.earth_p90_error}.`,
    `This point has no independent check against NASA's maps.` +
      (accuracy.min_abs_lat >= 80
        ? ` On polar ridge tops, our full model itself reads 3 to 24 points above NASA's Sun map, so ` +
          `treat ridge results with care.`
        : ''),
  ]
}
