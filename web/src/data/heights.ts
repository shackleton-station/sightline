import { decodeRuns, type SiteFlags } from '../lib/flags'
import { BASE_HEIGHT_M, isBaseHeights, type MissionHeights, mixFlags, mixTracks } from '../lib/heights'
import { joinOverviews, type YearSpan, yearsOf } from '../lib/span'
import type { HorizonPoint, Overview, OverviewYear, SiteInfo, TrackPoint } from './contract'
import { bytes, gunzip, isCustomSite } from './customSite'
import { loadScenario, loadSiteFlags } from './loadSite'
import type { ScenarioData } from './scenarioData'

// The hourly files for heights other than the app's own 2 m: 4 m, 5 m and 10 m at the listed sites
// (docs/VALIDATION.md §15). They are laid out like /data/, gzipped, under the light grids' folder,
// and nothing here is asked for until a height other than 2 m is chosen.

const RETRY_AFTER_MS = 700

const requests = new Map<string, Promise<unknown>>()

/** One file of another height's set, fetched and unpacked once; a failed request can be retried. */
function getHeightJson<T>(heightM: number, path: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}tiles/light/heights/${heightM}m/${path}.gz`
  const cached = requests.get(url)
  if (cached) return cached as Promise<T>
  const request = fetchTwice(url)
    .then(gunzip)
    .then((buffer) => JSON.parse(new TextDecoder().decode(buffer)) as T)
  request.catch(() => requests.delete(url))
  requests.set(url, request)
  return request
}

/** A file's bytes, asked for again after a moment if the first try fails: one bad answer among a dozen small files should not leave the screen at 2 m. */
async function fetchTwice(url: string): Promise<ArrayBuffer> {
  try {
    return await bytes(url)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS))
    return bytes(url)
  }
}

const spanKey = (span: YearSpan) => `${span.from}-${span.to}`
const overviews = new Map<string, Promise<Overview>>()

/** When the Sun and Earth are up at every listed site, seen from this height, over a span of years. */
function heightOverview(heightM: number, span: YearSpan): Promise<Overview> {
  const key = `${heightM}@${spanKey(span)}`
  const known = overviews.get(key)
  if (known) return known
  const request = Promise.all(yearsOf(span).map((year) => getHeightJson<OverviewYear>(heightM, `overview/${year}.json`))).then(joinOverviews)
  request.catch(() => overviews.delete(key))
  overviews.set(key, request)
  return request
}

const decoded = new Map<string, SiteFlags>()

/** A listed site's hourly flags seen from one height: the app's own files at 2 m, the height's set otherwise. */
async function flagsAtHeight(site: SiteInfo, span: YearSpan, heightM: number): Promise<SiteFlags> {
  if (heightM === BASE_HEIGHT_M) return loadSiteFlags(site, span)
  const key = `${site.id}@${heightM}@${spanKey(span)}`
  const known = decoded.get(key)
  if (known) return known
  const overview = await heightOverview(heightM, span)
  const runs = overview.sites[site.id]
  if (!runs) throw new Error(`no overview for ${site.id} at ${heightM} m`)
  const flags = {
    start: overview.start,
    sun: decodeRuns(runs.sun, overview.hours),
    earth: decodeRuns(runs.earth, overview.hours),
    earthAbove: Object.fromEntries(Object.entries(runs.earth_above).map(([degrees, above]) => [degrees, decodeRuns(above, overview.hours)])),
  }
  decoded.set(key, flags)
  return flags
}

const mixed = new Map<string, SiteFlags>()

/**
 * A site's hourly flags with the Sun seen from the panel's height and Earth from the antenna's.
 * At 2 m and 2 m, and for a custom point (worked out at 2 m only), these are the app's own flags.
 */
export async function loadSiteFlagsAt(site: SiteInfo, span: YearSpan, heights: MissionHeights): Promise<SiteFlags> {
  if (isCustomSite(site) || isBaseHeights(heights)) return loadSiteFlags(site, span)
  const key = `${site.id}@${heights.panelM}/${heights.antennaM}@${spanKey(span)}`
  const known = mixed.get(key)
  if (known) return known
  const [sun, earth] = await Promise.all([flagsAtHeight(site, span, heights.panelM), flagsAtHeight(site, span, heights.antennaM)])
  const flags = mixFlags(sun, earth)
  mixed.set(key, flags)
  return flags
}

/**
 * A site and month with the Sun's rows and skyline from the panel's height and Earth's from the
 * antenna's. The month's and years' summaries, the slope and the checks stay the app's own 2 m
 * ones: no file holds them for a mixed pair. At 2 m and 2 m, and for a custom point, this is
 * `loadScenario`, untouched.
 */
export async function loadScenarioAt(site: SiteInfo, month: string, span: YearSpan | undefined, heights: MissionHeights): Promise<ScenarioData> {
  const base = await loadScenario(site, month, span)
  if (isCustomSite(site) || isBaseHeights(heights)) return base
  const at = async (heightM: number): Promise<{ horizon: HorizonPoint[]; track: TrackPoint[] }> => {
    if (heightM === BASE_HEIGHT_M) return { horizon: base.horizon, track: base.track }
    const [horizon, track] = await Promise.all([getHeightJson<HorizonPoint[]>(heightM, `${site.id}/horizon.json`), getHeightJson<TrackPoint[]>(heightM, `${site.id}/${month}/track.json`)])
    return { horizon, track }
  }
  const [sun, earth] = await Promise.all([at(heights.panelM), at(heights.antennaM)])
  return { ...base, horizon: sun.horizon, earthHorizon: earth.horizon, track: mixTracks(sun.track, earth.track), heights }
}
