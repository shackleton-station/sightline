import type { SiteInfo } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { loadScenarioAt } from '../data/heights'
import { DEFAULT_HEIGHTS, type MissionHeights } from '../lib/heights'
import { type HourlyRow, hourlyCsv, hourlyFileName, hourlyRows } from '../lib/hourlyCsv'
import { locateHour } from '../lib/mission'
import { isoAt } from '../lib/sightline'
import type { YearSpan } from '../lib/span'

/**
 * "Hourly Sun and Earth (CSV)": one scenario's mission, hour by hour, as a file.
 *
 * The rows are read the way the screen reads them: the site's months from the landing to the
 * mission's end, with the Sun seen from the panel's height and Earth from the antenna's, and each
 * body measured against the skyline from its own height. So a row says what the time bar says at
 * that hour. A custom point is worked out at 2 m only, as on the screen, and the file says 2 m.
 */

/** What one file is made from: all of it is on hand wherever a scenario is shown. */
export interface HourlyRequest {
  /** The scenario's site: a listed one, or a custom point. */
  site: SiteInfo
  /** The first hour of the data, UTC: hours are counted from it. */
  start: string
  /** The scenario's landing, in hours after `start`. */
  landing: number
  missionDays: number
  /** The years of data on hand. */
  years: YearSpan
  /** The mission's heights above the ground. */
  heights: MissionHeights
}

/** Why a file could not be made, in words a visitor can read. */
export class HourlyProblem extends Error {}

let dataVersion: Promise<string | null> | null = null

/** The hash of the site data this build carries, written beside the built site; null where there is none (a development server). */
function loadDataVersion(): Promise<string | null> {
  dataVersion ??= fetch(`${import.meta.env.BASE_URL}data-version.json`)
    .then((response) => (response.ok ? (response.json() as Promise<{ dataVersion?: unknown }>) : null))
    .then((body) => (typeof body?.dataVersion === 'string' ? body.dataVersion : null))
    .catch(() => null)
  return dataVersion
}

/** The file for one scenario's mission: its name and its text. */
export async function hourlyFile({ site, start, landing, missionDays, years, heights }: HourlyRequest): Promise<{ name: string; text: string }> {
  const seenFrom = isCustomSite(site) ? DEFAULT_HEIGHTS : heights
  const wanted = missionDays * 24
  const rows: HourlyRow[] = []
  while (rows.length < wanted) {
    const { month, index } = locateHour(start, landing + rows.length)
    let data: Awaited<ReturnType<typeof loadScenarioAt>>
    try {
      data = await loadScenarioAt(site, month, years, seenFrom)
    } catch (reason) {
      console.error(reason)
      throw new HourlyProblem(rows.length === 0 ? 'The hourly data could not be read just now. Try again in a moment.' : 'The mission runs past the end of the data, so its hours cannot all be written. Shorten the mission or land earlier.')
    }
    const part = data.track.slice(index, index + wanted - rows.length)
    if (part.length === 0) throw new HourlyProblem('The mission runs past the end of the data, so its hours cannot all be written. Shorten the mission or land earlier.')
    rows.push(...hourlyRows(part, data.horizon, data.earthHorizon))
  }
  const landingIso = isoAt(start, landing)
  const text = hourlyCsv({ site, landingIso, missionDays, heights: seenFrom, dataVersion: await loadDataVersion(), link: window.location.href }, rows)
  return { name: hourlyFileName(site.id, landingIso, missionDays), text }
}

/** Hands a text file to the browser to save. */
export function saveText(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Makes one scenario's hourly file and saves it. Resolves when the browser has it; rejects with an
 * `HourlyProblem`, whose message is ready to show, when the file cannot be made.
 */
export async function saveHourlyCsv(request: HourlyRequest): Promise<void> {
  const { name, text } = await hourlyFile(request)
  saveText(name, text)
}
