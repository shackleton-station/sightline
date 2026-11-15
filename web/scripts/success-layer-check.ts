/**
 * Checks the "Mission success probability" layer's own reading of the data against the pipeline's
 * hourly tracks for the listed sites: the tracks are worked out at each site's exact point, from
 * its own horizon, and are what the verdict on the page comes from.
 *
 *   npx tsx scripts/success-layer-check.ts [month]        (default 2026-11)
 *
 * Three things are measured, each over every landing hour of the month:
 *  1. The light grid's cell at a site against the site's track, hour by hour (Sun up, Earth up).
 *     The pipeline has measured this itself (public/data/light/validation.json); this reads the
 *     grid through the page's own code (`cellAt`, `upSeries`), so a cell looked up in the wrong
 *     place or the wrong way round would show here.
 *  2. The mission's verdict from the grid, as the layer works it out (`addMonth`, `lightVerdict`),
 *     against the app's own verdict on the track (`landingProblems`).
 *  3. The smooth Moon's verdict (`smoothMoonFit`), which colors the Moon away from the grid,
 *     against the same.
 *
 * The month files are read from the live site; everything else from this checkout.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { FITS } from '../src/lib/landingOdds'
import { cellAt, type LightMeta, lightMeta, type LightMetaFile, type LightMonth, readMonth, upSeries } from '../src/lib/lightGrid'
import { landingProblems, type Requirements } from '../src/lib/mission'
import { addMonth, lightVerdict, missionMonthsAt, startGaps } from '../src/lib/missionGrid'
import { smoothMoonFit, washPixel } from '../src/lib/moonWash'

const LIVE = 'https://lunarsightline.com'
const DATA = new URL('../public/data/', import.meta.url)
/** The mission the table in docs/VALIDATION.md was measured with: the Short stay before it limited radio silence to 24 h. */
const REQ: Requirements = { missionDays: 14, maxSunGapH: 24, maxEarthGapH: 99_999, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

interface Site {
  id: string
  name: string
  lat: number
  lon: number
}
interface TrackRow {
  sun_up: boolean
  earth_up: boolean
}

const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), 'utf8')) as T
const monthAfter = (month: string) => {
  const next = Number(month.slice(5, 7)) + 1
  return next > 12 ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(next).padStart(2, '0')}`
}
const pct = (same: number, all: number) => (all === 0 ? '   n/a' : `${((100 * same) / all).toFixed(1).padStart(5)}%`)

async function liveMonth(meta: LightMeta, month: string): Promise<LightMonth> {
  const response = await fetch(`${LIVE}/tiles/light/${month}.bin.gz`)
  if (!response.ok) throw new Error(`${month}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Some servers have already unpacked it; gzip's first two bytes tell the cases apart.
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
  return readMonth(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta, month)
}

/** One cell of a month as a grid of its own, so the layer's own pass can be run for one place at a time. */
function oneCell(month: LightMonth, col: number, row: number): LightMonth {
  const cells = month.size * month.size
  const at = row * month.size + col
  const take = (planes: Uint16Array, slots: number) => Uint16Array.from({ length: slots }, (_, slot) => planes[slot * cells + at])
  return { ...month, size: 1, sun: take(month.sun, month.sunSlots), earth: take(month.earth, month.earthSlots) }
}

async function main() {
  const month = process.argv[2] ?? '2026-11'
  const next = monthAfter(month)
  const meta = lightMeta(json<LightMetaFile>('light/meta.json'))
  const liveMeta = (await (await fetch(`${LIVE}/data/light/meta.json`)).json()) as LightMetaFile
  console.log(`Light grid description, live against this checkout: ${JSON.stringify(liveMeta) === JSON.stringify(json<LightMetaFile>('light/meta.json')) ? 'the same' : 'DIFFERENT'}`)
  const head = await fetch(`${LIVE}/tiles/light/${month}.bin.gz`, { method: 'HEAD' })
  console.log(`Live ${month}.bin.gz last changed: ${head.headers.get('last-modified') ?? 'not said'}\n`)

  const sites = json<Site[]>('sites.json')
  const months = [await liveMonth(meta, month), await liveMonth(meta, next)]
  const hours = months[0].hours
  const year = Number(month.slice(0, 4))
  const first = (Date.parse(`${month}-01T00:00:00Z`) - Date.UTC(year, 0, 1)) / 3_600_000
  const positions = new Float32Array(readFileSync(new URL(`custom/ephemeris-${year}.bin`, DATA)).buffer)

  console.log(`${month}, a landing at every hour (${hours}), mission: 14 days, at most 24 h of dark, no limit on radio silence, Sun and Earth up at landing.`)
  console.log('Agreement with the site\'s own track (worked out at its exact point):\n')
  console.log('site                    in grid   Sun up   Earth up   verdict: grid   verdict: smooth Moon   landings that fit (track)')
  for (const site of sites) {
    const track = [...json<TrackRow[]>(`${site.id}/${month}/track.json`), ...json<TrackRow[]>(`${site.id}/${next}/track.json`)]
    const sun = track.map((row) => row.sun_up)
    const earth = track.map((row) => row.earth_up)
    const truth = Array.from({ length: hours }, (_, t) => landingProblems(sun, earth, t, REQ).length === 0)
    const fitShare = truth.filter(Boolean).length / hours

    const cell = cellAt(meta, site.lat, site.lon)
    let sunSame = 0
    let earthSame = 0
    let gridSame = 0
    if (cell) {
      const gridSun = upSeries(months[0], 'sun', cell)
      const gridEarth = upSeries(months[0], 'earth', cell)
      for (let t = 0; t < hours; t += 1) {
        if (Boolean(gridSun[t]) === sun[t]) sunSame += 1
        if (Boolean(gridEarth[t]) === earth[t]) earthSame += 1
      }
      const mine = months.map((whole) => oneCell(whole, cell.col, cell.row))
      for (let t = 0; t < hours; t += 1) {
        const parts = missionMonthsAt(meta, month, t, REQ.missionDays)
        if (!parts) throw new Error('the mission runs past the grid')
        const run = startGaps(1)
        parts.forEach((part, i) => addMonth(run, mine[i], part, i === 0))
        if ((lightVerdict(run, 0, REQ) === FITS) === truth[t]) gridSame += 1
      }
    }

    // The smooth Moon is slower to work out for the whole Moon, so it is tried every six hours.
    let smoothSame = 0
    let smoothAll = 0
    for (let t = 0; t < hours; t += 6) {
      const fit = smoothMoonFit(positions, first + t, REQ)
      if (!fit) continue
      smoothAll += 1
      if ((fit[washPixel(site.lat, site.lon)] === 1) === truth[t]) smoothSame += 1
    }
    console.log(
      `${site.name.padEnd(24)}${(cell ? 'yes' : 'no').padEnd(10)}${(cell ? pct(sunSame, hours) : '   n/a').padEnd(9)}${(cell ? pct(earthSame, hours) : '   n/a').padEnd(11)}${(cell ? pct(gridSame, hours) : '   n/a').padEnd(16)}${pct(smoothSame, smoothAll).padEnd(23)}${pct(Math.round(fitShare * hours), hours)}`,
    )
  }
}

await main()
