import type { TrackPoint } from '../data/contract'

const COLUMNS: (keyof TrackPoint)[] = [
  't',
  'sun_az',
  'sun_el',
  'sun_frac',
  'sun_up',
  'earth_az',
  'earth_el',
  'earth_up',
]

/**
 * The hourly track as CSV, one row per hour: times in UTC, angles in degrees, exactly as the
 * pipeline wrote them. `sun_vec_me` is left out; it's for drawing, not reading.
 */
export function trackCsv(track: TrackPoint[]): string {
  const rows = track.map((point) => COLUMNS.map((column) => String(point[column])).join(','))
  return [COLUMNS.join(','), ...rows].join('\n') + '\n'
}

/** A file name like `connecting-ridge_2027-05_hourly.csv`, safe for any site id. */
export function csvFileName(siteId: string, month: string): string {
  return `${siteId.replace(/[^a-z0-9.-]+/gi, '_')}_${month}_hourly.csv`
}
