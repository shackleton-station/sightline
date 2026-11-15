import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { DataRange, HorizonPoint, Overview, OverviewYear, SiteInfo, Summary, TrackPoint, Validation, YearSummary } from '../../src/data/contract'
import type { ScenarioData } from '../../src/data/scenarioData'
import { decodeRuns, type SiteFlags } from '../../src/lib/flags'
import { BASE_HEIGHT_M, isBaseHeights, type MissionHeights, mixFlags } from '../../src/lib/heights'
import { joinOverviews, joinYears, yearsOf } from '../../src/lib/span'
import type { Bucket } from '../bucket'
import { bucketLight, type LightSource, noLight } from './light'

export interface FlaggedSite {
  site: SiteInfo
  flags: SiteFlags
}

/** The pipeline's output, read from disk. The same files the browser loads from /data/. */
export interface SiteData {
  /** What span of time the data covers. */
  range(): Promise<DataRange>
  sites(): Promise<SiteInfo[]>
  /** Hour-by-hour Sun and Earth visibility for the whole span, for one listed site. */
  flags(siteId: string): Promise<SiteFlags>
  /**
   * The same, with the Sun seen from the solar panel's height and Earth from the antenna's (Sightline's
   * choice). The sets for heights other than the app's own 2 m are in the bucket; null when they
   * cannot be read here (no bucket, or a file is missing), so a caller can say its numbers are for 2 m.
   */
  flagsAt(siteId: string, heights: MissionHeights): Promise<SiteFlags | null>
  allFlags(): Promise<FlaggedSite[]>
  year(siteId: string): Promise<YearSummary>
  /** Everything one site-and-month view works from. */
  scenario(siteId: string, month: string): Promise<ScenarioData>
  /**
   * The share of the Sun's disc in view at each hour of one month, seen from the solar panel's
   * height: the app's own track at 2 m, the height's set in the bucket otherwise. Null when that
   * set cannot be read here.
   */
  sunSharesAt(siteId: string, month: string, panelM: number): Promise<number[] | null>
  /** The pipeline's comparison of every hour with NASA JPL Horizons for one listed site: how many hours, and the largest difference in degrees. Null if the file has none. */
  everyHourCheck(siteId: string): Promise<{ hours: number; maxDeg: number } | null>
  /** Sun and Earth at any 120 m of ground near the south pole (the Atlas's light grid). */
  light: LightSource
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
/** Hourly tracks are about 130 KB each; keep only the most recently used. */
const MAX_TRACKS = 36

export function siteData(dataDir: string, bucket?: Bucket | null): SiteData {
  const small = new Map<string, Promise<unknown>>()
  const tracks = new Map<string, Promise<TrackPoint[]>>()

  const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(join(dataDir, path), 'utf8')) as T
  const once = <T>(path: string): Promise<T> => {
    let found = small.get(path)
    if (!found) {
      found = read<T>(path)
      small.set(path, found)
      // A failed read (a missing file) isn't remembered, so a later call can try again.
      found.catch(() => small.delete(path))
    }
    return found as Promise<T>
  }
  const track = (path: string): Promise<TrackPoint[]> => {
    let found = tracks.get(path)
    if (found) tracks.delete(path)
    else found = read<TrackPoint[]>(path)
    tracks.set(path, found)
    found.catch(() => tracks.delete(path))
    if (tracks.size > MAX_TRACKS) tracks.delete(tracks.keys().next().value as string)
    return found
  }

  const sites = () => once<SiteInfo[]>('sites.json')
  const range = () => once<DataRange>('range.json')
  /** Every year of a file the pipeline writes once per calendar year, in order. */
  const everyYear = async <T>(path: (year: number) => string): Promise<T[]> => {
    const { first_year, last_year } = await range()
    return Promise.all(yearsOf({ from: first_year, to: last_year }).map((year) => once<T>(path(year))))
  }
  // The browser joins only the years a page shows; here every year is on disk, so tools see the whole range.
  let whole: Promise<Overview> | null = null
  const overviewOnce = (): Promise<Overview> => {
    if (!whole) {
      whole = everyYear<OverviewYear>((year) => `overview/${year}.json`).then(joinOverviews)
      whole.catch(() => {
        whole = null
      })
    }
    return whole
  }
  const years = new Map<string, Promise<YearSummary>>()
  const yearOnce = (siteId: string): Promise<YearSummary> => {
    let found = years.get(siteId)
    if (!found) {
      found = everyYear<YearSummary>((year) => `${siteId}/year-${year}.json`).then(joinYears)
      years.set(siteId, found)
      found.catch(() => years.delete(siteId))
    }
    return found
  }
  /** The listed site with this id. Ids are checked here, so they are safe to put in a file path. */
  const known = async (siteId: string): Promise<SiteInfo> => {
    const site = (await sites()).find((candidate) => candidate.id === siteId)
    if (!site) throw new Error(`Unknown site: ${siteId}`)
    return site
  }

  const flags = async (siteId: string): Promise<SiteFlags> => {
    await known(siteId)
    const overview = await overviewOnce()
    const runs = overview.sites[siteId]
    if (!runs) throw new Error(`No overview for ${siteId}`)
    return {
      start: overview.start,
      sun: decodeRuns(runs.sun, overview.hours),
      earth: decodeRuns(runs.earth, overview.hours),
      earthAbove: Object.fromEntries(
        Object.entries(runs.earth_above).map(([deg, r]) => [deg, decodeRuns(r, overview.hours)]),
      ),
    }
  }
  // Decoding every year of hours for a site is quick but not free; do it once per site.
  const decoded = new Map<string, Promise<SiteFlags>>()
  const flagsOnce = (siteId: string): Promise<SiteFlags> => {
    let found = decoded.get(siteId)
    if (!found) {
      found = flags(siteId)
      decoded.set(siteId, found)
      found.catch(() => decoded.delete(siteId))
    }
    return found
  }

  // The other heights' overviews (docs/VALIDATION.md §15): gzipped JSON in the bucket, one file a year.
  const heightOverviews = new Map<number, Promise<Overview | null>>()
  const heightOverview = (heightM: number): Promise<Overview | null> => {
    let found = heightOverviews.get(heightM)
    if (!found) {
      found = (async () => {
        if (!bucket) return null
        const { first_year, last_year } = await range()
        const parts = await Promise.all(
          yearsOf({ from: first_year, to: last_year }).map(async (year) => {
            const object = await bucket.get(`tiles/light/heights/${heightM}m/overview/${year}.json.gz`)
            if (!object) return null
            return JSON.parse(gunzipSync(new Uint8Array(await new Response(object.body).arrayBuffer())).toString('utf8')) as OverviewYear
          }),
        )
        return parts.every((part) => part !== null) ? joinOverviews(parts as OverviewYear[]) : null
      })()
      heightOverviews.set(heightM, found)
      // A failed read isn't remembered, so a later question can try again.
      found.then((overview) => overview ?? heightOverviews.delete(heightM)).catch(() => heightOverviews.delete(heightM))
    }
    return found
  }
  const flagsAtHeight = async (siteId: string, heightM: number): Promise<SiteFlags | null> => {
    if (heightM === BASE_HEIGHT_M) return flagsOnce(siteId)
    const overview = await heightOverview(heightM).catch(() => null)
    const runs = overview?.sites[siteId]
    if (!overview || !runs) return null
    return {
      start: overview.start,
      sun: decodeRuns(runs.sun, overview.hours),
      earth: decodeRuns(runs.earth, overview.hours),
      earthAbove: Object.fromEntries(Object.entries(runs.earth_above).map(([deg, r]) => [deg, decodeRuns(r, overview.hours)])),
    }
  }

  return {
    light: bucket ? bucketLight(bucket, dataDir) : noLight,
    range,
    sites,
    flags: flagsOnce,
    async flagsAt(siteId, heights) {
      await known(siteId)
      if (isBaseHeights(heights)) return flagsOnce(siteId)
      const [sun, earth] = await Promise.all([flagsAtHeight(siteId, heights.panelM), flagsAtHeight(siteId, heights.antennaM)])
      return sun && earth ? mixFlags(sun, earth) : null
    },
    async allFlags() {
      return Promise.all((await sites()).map(async (site) => ({ site, flags: await flagsOnce(site.id) })))
    },
    async year(siteId) {
      await known(siteId)
      return yearOnce(siteId)
    },
    async sunSharesAt(siteId, month, panelM) {
      await known(siteId)
      if (!MONTH.test(month)) throw new Error(`Bad month: ${month}`)
      if (panelM === BASE_HEIGHT_M) return (await track(`${siteId}/${month}/track.json`)).map((point) => point.sun_frac)
      if (!bucket) return null
      const object = await bucket.get(`tiles/light/heights/${panelM}m/${siteId}/${month}/track.json.gz`).catch(() => null)
      if (!object) return null
      const rows = JSON.parse(gunzipSync(new Uint8Array(await new Response(object.body).arrayBuffer())).toString('utf8')) as TrackPoint[]
      return rows.map((point) => point.sun_frac)
    },
    async everyHourCheck(siteId) {
      await known(siteId)
      const file = await once<{ sites: Record<string, { hours: number; max_deg: number }> }>('horizons.json').catch(() => null)
      const found = file?.sites[siteId]
      return found ? { hours: found.hours, maxDeg: found.max_deg } : null
    },
    async scenario(siteId, month) {
      const site = await known(siteId)
      if (!MONTH.test(month)) throw new Error(`Bad month: ${month}`)
      const [horizon, validation, year, hourly, summary] = await Promise.all([
        once<HorizonPoint[]>(`${siteId}/horizon.json`),
        once<Validation>(`${siteId}/validation.json`),
        yearOnce(siteId),
        track(`${siteId}/${month}/track.json`),
        once<Summary>(`${siteId}/${month}/summary.json`),
      ])
      return { site, month, horizon, validation, custom: null, slope: site.slope ?? null, year, track: hourly, summary }
    },
  }
}
