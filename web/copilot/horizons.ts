import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DataRange, SiteInfo } from '../src/data/contract'
import { originAllowed, reply, visitorOf } from '../shared/http'
import type { Cache, Limiter } from '../shared/store'
import type { HorizonsAsk } from '../shared/tools/horizonsTool'
import { busyReply, countIfAllowed, saysLongerThan } from './busy'

/**
 * "Check with Horizons": NASA JPL's own answer for where the Sun and Earth stand in the sky of a
 * point on the Moon at one hour, asked of the Horizons API when a visitor asks for it.
 *
 * It lives in this service because this is the one with a way out to the internet (the web server
 * has none), and under /api/chat/ because that is the only prefix the load balancer sends here. Its
 * main use is a custom point, which has no comparison computed ahead of time.
 *
 * JPL's fair-use policy for its APIs (https://ssd-api.jpl.nasa.gov/doc/index.php): one request at a
 * time, cache and reuse, back off on errors, do not call it from a web page. So: the page calls this
 * route, never JPL; requests leave this copy one after another; an answer is kept for 30 days (the
 * ephemeris does not change); and a failure is answered quietly, with no retry.
 */
export const HORIZONS_PATH = '/api/chat/horizons'

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const BODIES = { sun: '10', earth: '399' } as const
/** How long one request to Horizons may take. It usually answers in about a second. */
const TIMEOUT_MS = 8000
const KEPT_TTL_S = 30 * 24 * 60 * 60
const MAX_BODY_CHARS = 400

export interface HorizonsLimits {
  /** Per visitor and minute, counted on every well-formed call. */
  each: Limiter
  /** Everyone together, per minute and per day, counted only for lookups that go to Horizons. */
  all: Limiter
  allDay: Limiter
}

export interface HorizonsDeps {
  allowedOrigins: string[]
  trustedProxies?: string[]
  /** The way out, so a test can stand in for JPL. */
  fetch?: typeof fetch
  /** How this service names itself to JPL. */
  userAgent?: string
  /** The hours the app has data for (range.json): nothing outside them is asked of Horizons. */
  range: () => Promise<Pick<DataRange, 'start' | 'end'>>
}

export interface HorizonsLookup {
  lat: number
  lon: number
  altKm: number
  /** A whole hour, UTC: "2027-05-06T13:00:00Z". */
  hour: string
}

export interface HorizonsAnswer extends HorizonsLookup {
  /** Apparent azimuth (from north, clockwise) and elevation above a level horizon, in degrees, as Horizons gives them. */
  sun: { azDeg: number; elDeg: number }
  earth: { azDeg: number; elDeg: number }
  /** The ephemeris Horizons said it used. */
  ephemeris: string | null
}

/** The point and hour asked for, or null if the request is not one this route answers. `span` is the data's first hour and the hour after its last. */
export function readLookup(body: string, span: Pick<DataRange, 'start' | 'end'>): HorizonsLookup | null {
  if (body.length > MAX_BODY_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { lat, lon, altKm = 0, hour } = parsed as { lat?: unknown; lon?: unknown; altKm?: unknown; hour?: unknown }
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof altKm !== 'number' || typeof hour !== 'string') return null
  if (!(Math.abs(lat) <= 90) || !(lon >= -180 && lon <= 360) || !(Math.abs(altKm) <= 12)) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(hour)) return null
  const at = Date.parse(hour)
  if (!(at >= Date.parse(span.start) && at < Date.parse(span.end))) return null
  return rounded({ lat, lon, altKm, hour })
}

/** Rounded as the cache keys them: about 10 m on the ground, a metre of height. Longitude as Horizons takes it, 0 to 360 east. */
function rounded({ lat, lon, altKm, hour }: HorizonsLookup): HorizonsLookup {
  return { lat: Number(lat.toFixed(4)), lon: Number((((lon % 360) + 360) % 360).toFixed(4)), altKm: Number(altKm.toFixed(3)), hour }
}

/** The address of one body's query: the pipeline's own (pipeline/src/clps/horizons.py), for one hour. */
export function queryUrl(body: keyof typeof BODIES, lookup: HorizonsLookup): string {
  const day = lookup.hour.slice(0, 10)
  const hh = lookup.hour.slice(11, 13)
  const params: [string, string][] = [
    ['format', 'text'],
    ['COMMAND', `'${BODIES[body]}'`],
    ['EPHEM_TYPE', "'OBSERVER'"],
    ['CENTER', "'coord@301'"],
    ['COORD_TYPE', "'GEODETIC'"],
    ['SITE_COORD', `'${lookup.lon},${lookup.lat},${lookup.altKm}'`],
    ['START_TIME', `'${day} ${hh}:00'`],
    // One minute later with an hour's step: one row, the hour itself.
    ['STOP_TIME', `'${day} ${hh}:01'`],
    ['STEP_SIZE', "'1h'"],
    ['QUANTITIES', "'4'"],
    ['ANG_FORMAT', "'DEG'"],
    ['CSV_FORMAT', "'YES'"],
  ]
  return `${API}?${params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')}`
}

/** The azimuth and elevation in a Horizons reply's one row, and the ephemeris it names; null if it has no such row. */
export function readReply(text: string): { azDeg: number; elDeg: number; ephemeris: string | null } | null {
  const table = text.split('$$SOE')[1]?.split('$$EOE')[0]
  const row = table?.trim().split('\n')[0]
  if (!row) return null
  // The time, two flags (the Sun's presence, an interfering body), then azimuth and elevation.
  const cells = row.split(',').map((cell) => cell.trim())
  const azDeg = Number(cells[3])
  const elDeg = Number(cells[4])
  if (cells[3] === '' || cells[4] === '' || !Number.isFinite(azDeg) || !Number.isFinite(elDeg)) return null
  return { azDeg, elDeg, ephemeris: /\{source:\s*([A-Za-z0-9_-]+)\}/.exec(text)?.[1] ?? null }
}

/** One request at a time from this copy of the service, as JPL asks. */
let line: Promise<unknown> = Promise.resolve()
function inLine<T>(job: () => Promise<T>): Promise<T> {
  const mine = line.then(job, job)
  line = mine.catch(() => undefined)
  return mine
}

async function ask(body: keyof typeof BODIES, lookup: HorizonsLookup, deps: Pick<HorizonsDeps, 'fetch' | 'userAgent'>): Promise<{ azDeg: number; elDeg: number; ephemeris: string | null } | null> {
  const response = await (deps.fetch ?? fetch)(queryUrl(body, lookup), {
    headers: { 'user-agent': deps.userAgent ?? 'lunar-visibility-check/1.0 (site lookup)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return response.ok ? readReply(await response.text()) : null
}

const keptKey = (lookup: HorizonsLookup) => `horizons:${lookup.lat},${lookup.lon},${lookup.altKm},${lookup.hour}`

/**
 * NASA's answer for one point and hour: from the cache when it is there, else from Horizons, if the
 * shared limits allow another request to JPL. `busyMs` says how long until they do; null means
 * Horizons was slow, down or sent no table. Never throws.
 */
export async function lookUp(
  lookup: HorizonsLookup,
  deps: Pick<HorizonsDeps, 'fetch' | 'userAgent'>,
  limits: Pick<HorizonsLimits, 'all' | 'allDay'>,
  cache: Cache,
): Promise<{ answer: HorizonsAnswer; cached: boolean } | { busyMs: number } | null> {
  const key = keptKey(lookup)
  const kept = await cache.get(key).catch(() => null)
  if (kept) {
    try {
      return { answer: JSON.parse(kept) as HorizonsAnswer, cached: true }
    } catch {
      // Not what was stored: ask again.
    }
  }

  const refused = await countIfAllowed([
    [limits.all, 'all'],
    [limits.allDay, 'all'],
  ])
  if (refused !== null) return { busyMs: refused }

  try {
    const [sun, earth] = await inLine(async () => [await ask('sun', lookup, deps), await ask('earth', lookup, deps)])
    if (!sun || !earth) return null
    const answer: HorizonsAnswer = {
      ...lookup,
      sun: { azDeg: sun.azDeg, elDeg: sun.elDeg },
      earth: { azDeg: earth.azDeg, elDeg: earth.elDeg },
      ephemeris: sun.ephemeris ?? earth.ephemeris,
    }
    await cache.set(key, JSON.stringify(answer), KEPT_TTL_S).catch(() => {})
    return { answer, cached: false }
  } catch (error) {
    console.warn('horizons lookup failed', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * POST /api/chat/horizons with `{ lat, lon, altKm, hour }`: NASA's azimuth and elevation of the Sun
 * and Earth there and then. Only this site's pages may call it; a visitor gets a few a minute; an
 * answer already fetched comes from the cache; and when Horizons is slow or down the answer is a
 * quiet 502, which the page shows as nothing.
 */
export async function handleHorizons(request: Request, deps: HorizonsDeps, limits: HorizonsLimits, cache: Cache): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405)
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  // Read before it is counted: a malformed request is a 400 and spends nothing.
  if (saysLongerThan(request, 2000)) return reply({ error: 'bad-request' }, 400)
  const lookup = readLookup(await request.text(), await deps.range())
  if (!lookup) return reply({ error: 'bad-request' }, 400)

  const visitor = visitorOf(request, deps.trustedProxies)
  const each = await limits.each.attempt(visitor)
  if (!each.allowed) return busyReply(429, each.retryAfterMs)

  const found = await lookUp(lookup, deps, limits, cache)
  if (!found) return reply({ error: 'upstream' }, 502)
  if ('busyMs' in found) return busyReply(429, found.busyMs)
  return reply({ ...found.answer, cached: found.cached })
}

/**
 * The same lookup for Scout's tool (shared/tools/horizonsTool.ts): one listed site at one hour, at
 * the height the pipeline's own comparison gave Horizons for that site (horizons.json), so the two
 * are measured from the same place. It shares the cache and the limits on requests to JPL; the
 * chat has its own limit per visitor.
 */
export function horizonsForTools(dataDir: string, deps: Pick<HorizonsDeps, 'fetch' | 'userAgent'>, limits: Pick<HorizonsLimits, 'all' | 'allDay'>, cache: Cache): HorizonsAsk {
  let heights: Promise<Record<string, { alt_km?: number }>> | null = null
  const heightOf = async (site: SiteInfo): Promise<number | null> => {
    heights ??= readFile(join(dataDir, 'horizons.json'), 'utf8').then((text) => (JSON.parse(text) as { sites: Record<string, { alt_km?: number }> }).sites)
    heights.catch(() => (heights = null))
    return (await heights)[site.id]?.alt_km ?? null
  }
  return async (site, hour) => {
    const altKm = await heightOf(site).catch(() => null)
    if (altKm === null) return null
    const found = await lookUp(rounded({ lat: site.lat, lon: site.lon, altKm, hour }), deps, limits, cache)
    if (!found) return null
    if ('busyMs' in found) return 'busy'
    return { sun: found.answer.sun, earth: found.answer.earth, ephemeris: found.answer.ephemeris, altKm: found.answer.altKm }
  }
}
