import type { GridStats, Summary, Validation } from '../data/contract'
import type { CustomQuality } from '../data/scenarioData'

/** A percentage with one decimal, e.g. 39 → "39.0%". */
export function pct(value: number): string {
  return `${value.toFixed(1)}%`
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
  /** True when this site differs from NASA's map by more than our typical error. */
  warning: boolean
}

export interface ValidationNotes {
  horizons: string
  terrain: string
  earth: TrustNote
  sun: TrustNote
}

/**
 * States whether a long-run value agrees with NASA's map at this site, judged against the RMSE we
 * measured across many pixels. A site beyond that error says so rather than claiming validation.
 */
function compareWithMap(
  name: string,
  ours: number,
  map: number,
  grid: GridStats,
  [low, high]: [number, number],
): TrustNote {
  const difference = Math.abs(ours - map)
  const numbers =
    `${pct(ours)} here, ${pct(map)} on NASA's PGDA map ` +
    `(neighboring pixels ${low.toFixed(0)}–${high.toFixed(0)}%)`
  if (difference <= grid.rmse) {
    return { text: `${name} agrees with NASA's map: ${numbers}.`, warning: false }
  }
  return {
    text:
      `${name} at this site is not confirmed: ${numbers}. That's ${difference.toFixed(1)} points ` +
      `apart; across ${grid.n} other pixels the typical difference is ${grid.mae.toFixed(1)}.`,
    warning: true,
  }
}

/** Plain statements of how far this site's numbers can be trusted, over 18.6 years. */
export function validationNotes(validation: Validation, obsHeightM: number): ValidationNotes {
  const { pgda, horizons } = validation
  const ours = pgda.ours.find((row) => row.obs_height_m === obsHeightM)
  const gridFor = (quantity: string) =>
    pgda.grid.stats.find(
      (row) =>
        row.quantity === quantity && row.obs_height_m === obsHeightM && row.sample === 'all',
    )
  const sunGrid = gridFor('sun_mean_disk_pct')
  const earthGrid = gridFor('earth_any_pct')
  if (!ours || !sunGrid || !earthGrid) {
    throw new Error(`no validation results for observer height ${obsHeightM} m`)
  }

  const separation = horizons.max_sep_deg < 0.001 ? 'under 0.001' : horizons.max_sep_deg.toFixed(3)
  const unchecked = (name: string): TrustNote => ({
    text: `${name} has no independent check here: NASA's polar maps don't reach this latitude.`,
    warning: false,
  })
  const { map } = pgda
  return {
    horizons: `Sun and Earth positions match JPL Horizons to ${separation}° (${horizons.checks.length} checks).`,
    terrain:
      `Terrain near this site is LOLA at ${validation.terrain_resolution_m.toFixed(0)} m per pixel, ` +
      `so smaller rocks and craters aren't captured.`,
    earth: map
      ? compareWithMap(
          'Earth visibility',
          ours.earth_any_pct,
          map.earth_pct,
          earthGrid,
          map.earth_nearby_pct,
        )
      : unchecked('Earth visibility'),
    sun: map
      ? compareWithMap('Sun', ours.sun_mean_disk_pct, map.sun_pct, sunGrid, map.sun_nearby_pct)
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
