import type { HorizonPoint, TrackPoint } from '../data/contract'
import { horizonAt } from './customModel'
import type { MissionHeights } from './heights'

/**
 * The hour-by-hour Sun and Earth of one mission as a CSV file a spreadsheet or a script can read
 * without this app: what the file is about in its first lines, then one row for each hour.
 *
 * Every number is the app's own data. The azimuths, elevations, the Sun's share and the two "in
 * view" answers are the pipeline's hourly rows, untouched. The two "above the skyline" columns are
 * what the time bar prints: the body's elevation less the skyline's in its direction.
 */

/** One hour of the file. Angles in degrees. */
export interface HourlyRow {
  /** The hour, UTC, as the pipeline wrote it: "2027-05-06T13:00:00Z". */
  t: string
  sunAzDeg: number
  sunElDeg: number
  /** The Sun's centre above the skyline in its direction; negative when below. */
  sunAboveDeg: number
  /** The share of the Sun's disc in view, 0 to 1. */
  sunShare: number
  sunUp: boolean
  earthAzDeg: number
  earthElDeg: number
  /** Earth's centre above the skyline in its direction; negative when below. */
  earthAboveDeg: number
  earthUp: boolean
}

/** What the file's first lines say. */
export interface HourlyAbout {
  site: { name: string; lat: number; lon: number }
  /** The landing hour, UTC: "2027-05-06T13:00:00Z". */
  landingIso: string
  missionDays: number
  /** The heights above the ground the Sun and Earth are seen from. */
  heights: MissionHeights
  /** The hash of the site data this build carries; null when it could not be read. */
  dataVersion: string | null
  /** The address that opens the same plan, when there is one to give. */
  link?: string
}

/** The columns, in order: plain names with their units. */
export const HOURLY_COLUMNS = [
  'Time (UTC)',
  'Time after landing (hours)',
  'Sun azimuth (degrees clockwise from north)',
  'Sun elevation (degrees above level)',
  'Sun above the skyline (degrees)',
  "Sun's disc in view (share from 0 to 1)",
  'Sun in view (yes or no)',
  'Earth azimuth (degrees clockwise from north)',
  'Earth elevation (degrees above level)',
  'Earth above the skyline (degrees)',
  'Earth in view (yes or no)',
] as const

/** Two decimals, the pipeline's own precision, with no "-0.00". */
function hundredths(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return (rounded === 0 ? 0 : rounded).toFixed(2)
}

/**
 * The file's rows for a run of the pipeline's hourly rows at one site. `horizon` is the skyline
 * under the Sun; `earthHorizon` the one under Earth when it is seen from another height.
 */
export function hourlyRows(track: TrackPoint[], horizon: HorizonPoint[], earthHorizon: HorizonPoint[] = horizon): HourlyRow[] {
  return track.map((point) => ({
    t: point.t,
    sunAzDeg: point.sun_az,
    sunElDeg: point.sun_el,
    sunAboveDeg: point.sun_el - horizonAt(horizon, point.sun_az),
    sunShare: point.sun_frac,
    sunUp: point.sun_up,
    earthAzDeg: point.earth_az,
    earthElDeg: point.earth_el,
    earthAboveDeg: point.earth_el - horizonAt(earthHorizon, point.earth_az),
    earthUp: point.earth_up,
  }))
}

/** A field as CSV holds it: quoted when it has a comma, a quote or a line break. */
function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The whole file. The first lines start with "#" and say what the rows are about: the site and its
 * coordinates, the landing and the mission's length, the heights, and the data's version. Then the
 * column names, then one row for each hour from the landing.
 */
export function hourlyCsv(about: HourlyAbout, rows: HourlyRow[]): string {
  const { site, heights } = about
  const head = [
    'Sightline: the Sun and Earth, hour by hour, over one mission',
    `Site: ${site.name}`,
    `Latitude (degrees, north positive): ${site.lat}`,
    `Longitude (degrees, east positive): ${site.lon}`,
    `Landing (UTC): ${about.landingIso}`,
    `Mission: ${about.missionDays} ${about.missionDays === 1 ? 'day' : 'days'}, ${rows.length} hours from the landing, one row for each hour`,
    `Sun seen from: ${heights.panelM} m above the ground`,
    `Earth seen from: ${heights.antennaM} m above the ground`,
    `Data version: ${about.dataVersion ?? 'not known'}`,
    'Times are UTC. Angles are in degrees. Elevation is above level ground; "above the skyline" is the elevation of the center of the Sun or Earth less the height of the skyline in its direction, and is negative when the centre is below the skyline.',
    '"In view" is yes when any part of the disc shows above the skyline.',
    ...(about.link ? [`This plan: ${about.link}`] : []),
  ]
  const landingMs = Date.parse(about.landingIso)
  const lines = rows.map((row) =>
    [
      row.t,
      String(Math.round((Date.parse(row.t) - landingMs) / 3_600_000)),
      String(row.sunAzDeg),
      String(row.sunElDeg),
      hundredths(row.sunAboveDeg),
      String(row.sunShare),
      row.sunUp ? 'yes' : 'no',
      String(row.earthAzDeg),
      String(row.earthElDeg),
      hundredths(row.earthAboveDeg),
      row.earthUp ? 'yes' : 'no',
    ].join(','),
  )
  return `${[...head.map((line) => `# ${line}`), HOURLY_COLUMNS.map(field).join(','), ...lines].join('\n')}\n`
}

/** A file name like `sightline-hourly_connecting-ridge_2027-05-06T13Z_14d.csv`, safe for any site id. */
export function hourlyFileName(siteId: string, landingIso: string, missionDays: number): string {
  return `sightline-hourly_${siteId.replace(/[^a-z0-9.-]+/gi, '_')}_${landingIso.slice(0, 13)}Z_${missionDays}d.csv`
}
