import { decodeRuns, type SiteFlags } from '../lib/flags'
import { joinOverviews, joinYears, spanFor, type YearSpan, yearsInHash, yearsOf } from '../lib/span'
import { isCustomSite, loadCustomFlags, loadCustomHeights, loadCustomMonth } from './customSite'
import { reloadIfStale } from './staleBuild'
import type { ScenarioData } from './scenarioData'
import type {
  DataRange,
  EarthSunMonth,
  HorizonPoint,
  LrocCheck,
  LrocPhotos,
  MapMeta,
  MastHeight,
  MoonFeatures,
  Overview,
  OverviewYear,
  SiteInfo,
  SiteSpread,
  Summary,
  TrackPoint,
  Validation,
  YearSummary,
} from './contract'

/** How far to trust a custom point. */
export type { CustomQuality, ScenarioData } from './scenarioData'

const requests = new Map<string, Promise<unknown>>()

/** Fetch a data file once; repeat requests share the result. A failed request can be retried. */
function getJson<T>(path: string): Promise<T> {
  const cached = requests.get(path)
  if (cached) return cached as Promise<T>
  const request = fetch(`${import.meta.env.BASE_URL}data/${path}`).then((response) => {
    if (!response.ok) {
      // A missing file usually means this tab runs an older build than the one now live.
      if (response.status === 404) void reloadIfStale()
      throw new Error(`${path}: HTTP ${response.status}`)
    }
    return response.json() as Promise<T>
  })
  request.catch(() => requests.delete(path))
  requests.set(path, request)
  return request
}

export function loadMapMeta(): Promise<MapMeta> {
  return getJson<MapMeta>('maps/meta.json')
}

export function loadFeatures(): Promise<MoonFeatures> {
  return getJson<MoonFeatures>('features.json')
}

export function loadSites(): Promise<SiteInfo[]> {
  return getJson<SiteInfo[]>('sites.json')
}

export function loadEarthSun(month: string): Promise<EarthSunMonth> {
  return getJson<EarthSunMonth>(`earth-sun/${month}.json`)
}

/** What span of time the data covers: its first and last hour and year. The same small file however long that is. */
export function loadRange(): Promise<DataRange> {
  return getJson<DataRange>('range.json')
}

let pageSpanRequest: Promise<YearSpan> | null = null

/**
 * The years this page works with unless it asks for others: those around the dates in the address
 * it was opened at, or around the data's default month. Decided once, so every hour the page
 * counts is counted from the same first hour for as long as it is open.
 */
export function pageSpan(): Promise<YearSpan> {
  if (!pageSpanRequest) {
    pageSpanRequest = loadRange().then((range) => spanFor(yearsInHash(window.location.hash), range))
    pageSpanRequest.catch(() => {
      pageSpanRequest = null
    })
  }
  return pageSpanRequest
}

const spanKey = (span: YearSpan) => `${span.from}-${span.to}`

/** The last span's overview, joined: every site's flags come from it, so it is joined once. */
let joinedOverview: { key: string; request: Promise<Overview> } | null = null

/** When the Sun and Earth are up at every listed site over a span of years: one small file a year. */
export async function loadOverview(span?: YearSpan): Promise<Overview> {
  const at = span ?? (await pageSpan())
  const key = spanKey(at)
  if (joinedOverview?.key === key) return joinedOverview.request
  const request = Promise.all(yearsOf(at).map((year) => getJson<OverviewYear>(`overview/${year}.json`))).then(joinOverviews)
  joinedOverview = { key, request }
  request.catch(() => {
    if (joinedOverview?.request === request) joinedOverview = null
  })
  return request
}

export { loadYearPositions } from './customSite'

/** Each listed site's flags for the span last asked for; a longer span replaces the shorter one. */
const curatedFlags = new Map<string, { key: string; flags: SiteFlags }>()

/**
 * Hourly Sun and Earth flags for a site over a span of years (the page's own, unless given), for
 * everything the app works out across dates.
 */
export async function loadSiteFlags(site: SiteInfo, span?: YearSpan): Promise<SiteFlags> {
  const at = span ?? (await pageSpan())
  if (isCustomSite(site)) return loadCustomFlags(site, at)
  const key = spanKey(at)
  const known = curatedFlags.get(site.id)
  if (known?.key === key) return known.flags
  const overview = await loadOverview(at)
  const runs = overview.sites[site.id]
  if (!runs) throw new Error(`no overview for ${site.id}`)
  const flags = {
    start: overview.start,
    sun: decodeRuns(runs.sun, overview.hours),
    earth: decodeRuns(runs.earth, overview.hours),
    earthAbove: Object.fromEntries(
      Object.entries(runs.earth_above).map(([degrees, above]) => [degrees, decodeRuns(above, overview.hours)]),
    ),
  }
  curatedFlags.set(site.id, { key, flags })
  return flags
}

/** Heights above the ground compared for a taller mast (m), as in the pipeline's nearby.py. */
const MAST_HEIGHTS_M = [2, 5, 10]

/** A site's yearly numbers at each height above the ground, for the page's years. */
/** A listed site's skyline: the terrain's height all the way round, every half degree. */
export function loadHorizon(site: SiteInfo): Promise<HorizonPoint[]> {
  return getJson<HorizonPoint[]>(`${site.id}/horizon.json`)
}

/** A listed site's hourly Sun and Earth positions for one month ("YYYY-MM"). */
export function loadTrack(site: SiteInfo, month: string): Promise<TrackPoint[]> {
  return getJson<TrackPoint[]>(`${site.id}/${month}/track.json`)
}

export async function loadMastHeights(site: SiteInfo): Promise<MastHeight[]> {
  const span = await pageSpan()
  if (isCustomSite(site)) return loadCustomHeights(site, MAST_HEIGHTS_M, span)
  const heights = await getJson<MastHeight[]>(`${site.id}/heights.json`)
  return heights.map((height) => ({ ...height, years: height.years.filter((row) => row.year >= span.from && row.year <= span.to) }))
}

/** How a ridge site's numbers change within reach of a landing; null elsewhere. */
export function loadSpread(site: SiteInfo): Promise<SiteSpread | null> {
  return site.nearby_half_m ? getJson<SiteSpread>(`${site.id}/spread.json`) : Promise.resolve(null)
}

/** The model and NASA's map, compared with real photos of sunlight near the south pole. */
export function loadLrocCheck(): Promise<LrocCheck> {
  return getJson<LrocCheck>('lroc-check.json')
}

/** The model compared with individual dated photos near the south pole. */
export function loadLrocPhotos(): Promise<LrocPhotos> {
  return getJson<LrocPhotos>('lroc-photos.json')
}

const RELOADED_FOR_MONTH = 'reloaded-for-month'

/**
 * A page that counts its hours from its own years (`pageSpan`) and is sent to a month outside
 * them, by a link pasted into the open tab or an answer from the co-pilot, starts again at its new
 * address: its years are then the ones around that month. True if the page is reloading. It does
 * so only when the address already names the month's year, and once per month, so it cannot loop.
 */
function reopenFor(month: string): boolean {
  const year = Number(month.slice(0, 4))
  if (!yearsInHash(window.location.hash).includes(year)) return false
  try {
    if (sessionStorage.getItem(RELOADED_FOR_MONTH) === month) return false
    sessionStorage.setItem(RELOADED_FOR_MONTH, month)
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * Everything one site-and-month view works from. Its yearly numbers are for a span of years: the
 * page's own, unless one is given.
 */
export async function loadScenario(site: SiteInfo, month: string, span?: YearSpan): Promise<ScenarioData> {
  const at = span ?? (await pageSpan())
  const year = Number(month.slice(0, 4))
  if (year < at.from || year > at.to) {
    // Reloading: leave the page as it is until the new one replaces it.
    if (!span && reopenFor(month)) return new Promise<ScenarioData>(() => {})
    throw new Error(`${month} is outside the years this page has loaded (${at.from} to ${at.to})`)
  }
  if (isCustomSite(site)) {
    const { accuracy, ridges, resolutionM, modelError, slope, ...rest } = await loadCustomMonth(site, month, at)
    return {
      site,
      month,
      validation: null,
      custom: { accuracy, ridges, resolutionM, modelError },
      slope,
      ...rest,
    }
  }
  const [horizon, validation, years, track, summary] = await Promise.all([
    getJson<HorizonPoint[]>(`${site.id}/horizon.json`),
    getJson<Validation>(`${site.id}/validation.json`),
    Promise.all(yearsOf(at).map((y) => getJson<YearSummary>(`${site.id}/year-${y}.json`))),
    getJson<TrackPoint[]>(`${site.id}/${month}/track.json`),
    getJson<Summary>(`${site.id}/${month}/summary.json`),
  ])
  return { site, month, horizon, validation, custom: null, slope: site.slope ?? null, year: joinYears(years), track, summary }
}
