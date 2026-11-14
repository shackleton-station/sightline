import type { GridStats } from '../data/contract'
import type { ScenarioData } from '../data/scenarioData'
import { type PanelSunlight, panelSunlight } from './power'
import { pct } from './verdict'

export interface CompareRow {
  label: string
  a: string
  b: string
  /** Which scenario does better, or a plain statement that the difference is too small to call. */
  better: 'A' | 'B' | 'Too close' | 'Same'
}

interface Metric {
  label: string
  value: (data: ScenarioData) => number
  format: (value: number) => string
  higherIsBetter: boolean
  /** Differences up to this size can't be told apart; 0 means any difference counts. */
  tolerance: number
}

/** What the table compares: "Sun up" counts any part of the disk, so it's judged on that measure. */
type MapQuantity = 'sun_any_pct' | 'earth_any_pct'

/** How far the model reads from NASA's map at this site (signed points); 0 where no map reaches. */
function siteDifference(data: ScenarioData, quantity: MapQuantity): number {
  const pgda = data.validation?.pgda
  if (!pgda?.map) return 0
  const ours = pgda.ours.find((row) => row.obs_height_m === data.summary.obs_height_m)
  if (!ours) throw new Error(`no results at ${data.summary.obs_height_m} m for ${data.site.id}`)
  const map = quantity === 'sun_any_pct' ? pgda.map.sun_pct : pgda.map.earth_pct
  return ours[quantity] - map
}

/** Error measured for one scenario. A custom point carries the full model's error plus its own. */
function measuredError(data: ScenarioData, quantity: MapQuantity): number {
  if (data.custom) {
    const { accuracy, ridges, modelError } = data.custom
    const sample = ridges ?? accuracy
    return quantity === 'sun_any_pct'
      ? Math.max(sample.sun_p90_error, modelError.sun_any_rmse)
      : Math.max(sample.earth_p90_error, modelError.earth_rmse)
  }
  const obsHeightM = data.summary.obs_height_m
  const row = data.validation?.pgda.grid.stats.find(
    (stats: GridStats) =>
      stats.quantity === quantity && stats.obs_height_m === obsHeightM && stats.sample === 'all',
  )
  if (!row) throw new Error(`no validation results for ${quantity} at ${obsHeightM} m`)
  return row.rmse
}

/**
 * Smallest difference between two scenarios that means anything. At least the error measured for
 * either; for two different sites, also how differently the model reads at those sites, since that
 * alone could produce a gap between them.
 */
export function tolerance(a: ScenarioData, b: ScenarioData, quantity: MapQuantity): number {
  const base = Math.max(measuredError(a, quantity), measuredError(b, quantity))
  if (a.site.id === b.site.id) return base
  return Math.max(base, Math.abs(siteDifference(a, quantity) - siteDifference(b, quantity)))
}

function judge(a: number, b: number, higherIsBetter: boolean, tolerance: number): CompareRow['better'] {
  if (a === b) return 'Same'
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a > b === higherIsBetter ? 'A' : 'B'
  if (Math.abs(a - b) <= tolerance) return 'Too close'
  return a > b === higherIsBetter ? 'A' : 'B'
}

/** Highest solar elevation in the month, in degrees. */
export function peakSunElevation(data: ScenarioData): number {
  return Math.max(...data.track.map((point) => point.sun_el))
}

/** Average solar elevation while the Sun is up, in degrees; null if it never is. */
export function meanSunElevationUp(data: ScenarioData): number | null {
  const up = data.track.filter((point) => point.sun_up)
  if (up.length === 0) return null
  return up.reduce((sum, point) => sum + point.sun_el, 0) / up.length
}

/** The numbers a planner weighs, side by side. Percentages are judged against measured error. */
export function compareRows(a: ScenarioData, b: ScenarioData): CompareRow[] {
  const sunError = tolerance(a, b, 'sun_any_pct')
  const earthError = tolerance(a, b, 'earth_any_pct')
  const hours = (value: number) => `${value} h`
  // Each end of a gap is only known to the nearest sample, so hourly data can't separate less.
  const gapTolerance = 2 * a.summary.range.step_h
  const watts = (value: number) => `${value.toFixed(0)} W/m²`
  // A panel's sunlight is its average while the Sun is up times the share of time it's up, so an
  // error of this many points in that share changes sunlight in proportion to the panel's own value.
  const panelError = (kind: keyof PanelSunlight) =>
    Math.max(
      ...[a, b].map((data) =>
        data.summary.pct_sun > 0 ? (panelSunlight(data.track)[kind] * sunError) / data.summary.pct_sun : 0,
      ),
    )
  const metrics: Metric[] = [
    {
      label: 'Sun up',
      value: (d) => d.summary.pct_sun,
      format: pct,
      higherIsBetter: true,
      tolerance: sunError,
    },
    {
      label: 'Earth up',
      value: (d) => d.summary.pct_earth,
      format: pct,
      higherIsBetter: true,
      tolerance: earthError,
    },
    {
      label: 'Both up',
      value: (d) => d.summary.pct_both,
      format: pct,
      higherIsBetter: true,
      tolerance: Math.max(sunError, earthError),
    },
    {
      label: 'Longest without Sun',
      value: (d) => d.summary.max_sun_gap_h,
      format: hours,
      higherIsBetter: false,
      tolerance: gapTolerance,
    },
    {
      label: 'Longest without Earth',
      value: (d) => d.summary.max_earth_gap_h,
      format: hours,
      higherIsBetter: false,
      tolerance: gapTolerance,
    },
    {
      label: 'Highest Sun',
      value: peakSunElevation,
      format: (value) => `${value.toFixed(1)}°`,
      higherIsBetter: true,
      tolerance: 0.05,
    },
    {
      label: 'Sunlight on a vertical panel',
      value: (d) => panelSunlight(d.track).vertical,
      format: watts,
      higherIsBetter: true,
      tolerance: panelError('vertical'),
    },
    {
      label: 'Sunlight on a flat panel',
      value: (d) => panelSunlight(d.track).flat,
      format: watts,
      higherIsBetter: true,
      tolerance: panelError('flat'),
    },
    {
      label: 'Average Sun height while up',
      value: (d) => meanSunElevationUp(d) ?? Number.NEGATIVE_INFINITY,
      format: (value) => (Number.isFinite(value) ? `${value.toFixed(1)}°` : 'never up'),
      higherIsBetter: true,
      tolerance: 0.05,
    },
  ]
  return metrics.map(({ label, value, format, higherIsBetter, tolerance }) => ({
    label,
    a: format(value(a)),
    b: format(value(b)),
    better: judge(value(a), value(b), higherIsBetter, tolerance),
  }))
}

/** "Day 13, 12:00 UTC": the same position in a month, whichever month is shown. */
export function dayLabel(iso: string): string {
  return `Day ${Number(iso.slice(8, 10))}, ${iso.slice(11, 16)} UTC`
}
