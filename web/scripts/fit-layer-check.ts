/**
 * Checks the "Landings that fit" layer's picture round the ridge sites against the same question
 * answered point by point: at every 20 m of the ground, the point's own skyline from the 20 m
 * terrain and the mission judged hour by hour, as the verdict and the Landing accuracy panel judge
 * a point (`pointHorizons.ts`, `landingField.ts`).
 *
 *   npx tsx scripts/fit-layer-check.ts [month ...]        (default 2026-11 2027-06)
 *
 * For each ridge site, a square of the light grid's cells round it is taken (`REACH_CELLS` each
 * way). For a landing every `EVERY_H` hours of the month:
 *  - the truth: which 20 m points fit, and from them the odds for a lander aimed at each of the
 *    layer's pixels (the points blurred by the lander's own spread);
 *  - the layer: the same odds as the page's own code makes them (`fitField`, `layPatch`,
 *    `flatShare`, `oddsField`) from the light grid alone and with the site's 20 m patch laid in.
 * Only the middle of the square is scored, where every blur has ground all round it. Each picture
 * is scored twice: with the truth's own slope, so that only the Sun and Earth differ, and with the
 * slope as the page reads it from its slope images. Those images are made here from the terrain
 * as the pipeline makes them, so the JPEG's own loss is not in the score.
 *
 * The light grid's months, the patches' and the terrain tiles are read from the live site and kept
 * in node_modules/.cache/fit-layer-check; the skylines worked out are kept there too. Everything
 * else is from this checkout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import type { CustomMeta } from '../src/data/contract'
import { decodeTile, loadTiles, polarLatLon, type TileStore } from '../src/lib/customModel'
import { pointLight, type PointSky } from '../src/lib/landingField'
import { DEFAULT_SPREAD, FITS, type Spread } from '../src/lib/landingOdds'
import { cellAt, type LightMeta, lightMeta, type LightMetaFile, type LightMonth, type LightPatch, patchGrid, readMonth } from '../src/lib/lightGrid'
import { DEFAULT_REQUIREMENTS, type Requirements } from '../src/lib/mission'
import { addMonth, fitField, flatShare, layPatch, lightVerdict, missionMonthsAt, oddsField, startGaps } from '../src/lib/missionGrid'
import { AZIMUTHS, blockReachM, groundSlopeDeg, pointHorizons, polarBlock, type PolarGround } from '../src/lib/pointHorizons'

const LIVE = 'https://lunarsightline.com'
const DATA = new URL('../public/data/', import.meta.url)
const CACHE = fileURLToPath(new URL('../node_modules/.cache/fit-layer-check/', import.meta.url))
const HOUR_MS = 3_600_000

/** Light cells each way from the site's own cell, and how many of them at each edge are left out of the score. */
const REACH_CELLS = 6
const EDGE_CELLS = 3
/** The truth's points (m): the terrain's own pixels. */
const POINT_M = 20
/** A landing is tried every this many hours of the month. */
const EVERY_H = 12
/** Pixels along a light cell in the layer's picture (`shadeWorker.ts`). */
const SUB = 2
const MAX_SLOPE_DEG = 10
const HEIGHT_M = 2
/** The slope images' pixel (m), and the steepest slope (rise over run) their 8 bits hold. */
const SLOPE_PIXEL_M = 30
const SLOPE_MAX = 1

interface Site {
  id: string
  name: string
  lat: number
  lon: number
  group: string
}

const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), 'utf8')) as T
const arrayBuffer = (buffer: Uint8Array) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
const monthAfter = (month: string) => {
  const next = Number(month.slice(5, 7)) + 1
  return next > 12 ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(next).padStart(2, '0')}`
}

/** A file of the live site, unpacked; kept on disk so a second run reads nothing again. */
async function live(path: string): Promise<Uint8Array> {
  const kept = `${CACHE}${path.replaceAll('/', '_')}`
  let bytes: Uint8Array
  if (existsSync(kept)) bytes = readFileSync(kept)
  else {
    const response = await fetch(`${LIVE}/${path}`)
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    bytes = new Uint8Array(await response.arrayBuffer())
    writeFileSync(kept, bytes)
  }
  // Some servers have already unpacked it; gzip's first two bytes tell the cases apart.
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
}

/** A square of a month's pixels as a grid of its own, so the layer's own code can be run on it. */
function squareOf(month: LightMonth, col0: number, row0: number, side: number): LightMonth {
  const all = month.size * month.size
  const take = (planes: Uint16Array, slots: number) => {
    const out = new Uint16Array(slots * side * side)
    for (let slot = 0; slot < slots; slot += 1) {
      for (let row = 0; row < side; row += 1) {
        for (let col = 0; col < side; col += 1) out[slot * side * side + row * side + col] = planes[slot * all + (row0 + row) * month.size + col0 + col]
      }
    }
    return out
  }
  return { ...month, size: side, sun: take(month.sun, month.sunSlots), earth: take(month.earth, month.earthSlots) }
}

const yearFiles = new Map<number, Float32Array>()
function yearPositions(year: number): Float32Array {
  let held = yearFiles.get(year)
  if (!held) {
    held = new Float32Array(arrayBuffer(readFileSync(new URL(`custom/ephemeris-${year}.bin`, DATA))))
    yearFiles.set(year, held)
  }
  return held
}

/** The Sun's and Earth's positions for `hours` hours from a moment, six numbers an hour. */
function positionsFrom(ms: number, hours: number): Float32Array {
  const out = new Float32Array(hours * 6)
  for (let hour = 0; hour < hours; hour += 1) {
    const at = ms + hour * HOUR_MS
    const year = new Date(at).getUTCFullYear()
    const inYear = Math.round((at - Date.UTC(year, 0, 1)) / HOUR_MS)
    out.set(yearPositions(year).subarray(inYear * 6, inYear * 6 + 6), hour * 6)
  }
  return out
}

/** How far a picture's odds are from the truth's, summed over the pixels scored. */
class Score {
  n = 0
  sum = 0
  abs = 0
  squares = 0
  far = 0
  add(mine: number, truth: number) {
    const diff = mine - truth
    this.n += 1
    this.sum += diff
    this.abs += Math.abs(diff)
    this.squares += diff * diff
    if (Math.abs(diff) > 0.25) this.far += 1
  }
  words(): string {
    const points = (value: number) => (100 * value).toFixed(1).padStart(6)
    return `${points(this.abs / this.n)} ${points(Math.sqrt(this.squares / this.n))} ${points(this.sum / this.n)} ${points(this.far / this.n)}%`
  }
}

/** The mean of a field of 20 m points over those one of the picture's pixels covers. */
function shareOf(field20: Float32Array, side20: number, per: number, pixel: number, side: number): number {
  const row = Math.floor(pixel / side) * per
  const col = (pixel % side) * per
  let sum = 0
  for (let dRow = 0; dRow < per; dRow += 1) for (let dCol = 0; dCol < per; dCol += 1) sum += field20[(row + dRow) * side20 + col + dCol]
  return sum / (per * per)
}

/**
 * The slope images' own values for a square of the ground, made from the terrain as the pipeline
 * makes them (`slopes.py`, `build_slope_maps`): heights averaged onto 30 m pixels, differenced
 * across two pixels, and rounded to 8 bits. The JPEG's own loss is not in them.
 */
function slopeImages(ground: PolarGround, left: number, top: number, side: number): { x: Uint8Array; y: Uint8Array } {
  const { half_m: half, res_m: res, quant_m: quant } = ground.meta.polar
  const { col0, row0, width, values } = ground.block
  const per = SLOPE_PIXEL_M / res
  const firstCol = Math.round((left + half) / res)
  const firstRow = Math.round((half - top) / res)
  // One more pixel all round, for the differences at the square's edge.
  const wide = side + 2
  const mean = new Float64Array(wide * wide)
  const spans = (index: number) => {
    const from = (index - 1) * per
    const parts: [number, number][] = []
    for (let p = Math.floor(from); p < from + per; p += 1) parts.push([p, Math.min(p + 1, from + per) - Math.max(p, from)])
    return parts
  }
  for (let row = 0; row < wide; row += 1) {
    for (let col = 0; col < wide; col += 1) {
      let sum = 0
      let weight = 0
      for (const [r, wr] of spans(row)) {
        for (const [c, wc] of spans(col)) {
          sum += wr * wc * values[(firstRow + r - row0) * width + (firstCol + c - col0)] * quant
          weight += wr * wc
        }
      }
      mean[row * wide + col] = sum / weight
    }
  }
  const eight = (slope: number) => Math.round(128 + 127 * Math.max(-1, Math.min(1, slope / SLOPE_MAX)))
  const x = new Uint8Array(side * side)
  const y = new Uint8Array(side * side)
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const at = (row + 1) * wide + col + 1
      x[row * side + col] = eight((mean[at + 1] - mean[at - 1]) / (2 * SLOPE_PIXEL_M))
      // Rows run toward smaller y.
      y[row * side + col] = eight((mean[at - wide] - mean[at + wide]) / (2 * SLOPE_PIXEL_M))
    }
  }
  return { x, y }
}

/** The slope (degrees) two 8-bit values stand for, each the mean of some of the images' own. */
const slopeDeg = (x: number, y: number) => (Math.atan(Math.hypot(((x - 128) / 127) * SLOPE_MAX, ((y - 128) / 127) * SLOPE_MAX)) * 180) / Math.PI

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const months = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['2026-11', '2027-06']
  const req: Requirements = DEFAULT_REQUIREMENTS
  const spread: Spread = DEFAULT_SPREAD
  const light: LightMeta = lightMeta(json<LightMetaFile>('light/meta.json'))
  const custom = json<CustomMeta>('custom/meta.json')
  const polarFar = decodeTile(arrayBuffer(gunzipSync(readFileSync(new URL('custom/polar-far.bin.gz', DATA)))), custom.polar.far_size)
  const sites = json<Site[]>('sites.json').filter((site) => site.group === 'South pole ridges')
  const cells = 2 * REACH_CELLS + 1
  const perCell = light.pixel_m / POINT_M
  const side20 = cells * perCell
  const side = cells * SUB
  const per = side20 / side
  const pixelM = light.pixel_m / SUB
  const points = side20 * side20
  const tiles: TileStore = new Map()
  const readTile = async (name: string) => arrayBuffer(await live(`tiles/${name}.bin.gz`))

  console.log(`Mission: ${req.missionDays} days, at most ${req.maxSunGapH} h of dark, Sun and Earth up at landing, slope at most ${MAX_SLOPE_DEG} deg; lander accuracy ${spread.accuracyM} m.`)
  console.log(`Round each site: ${cells} x ${cells} light cells (${(cells * light.pixel_m) / 1000} km), truth every ${POINT_M} m; the middle ${cells - 2 * EDGE_CELLS} x ${cells - 2 * EDGE_CELLS} cells are scored; a landing every ${EVERY_H} h.`)
  console.log('Odds are 0 to 100. Columns: the mean error, the root-mean-square error, the mean of (picture - truth), and the share of pixels more than 25 off.\n')

  const total = new Map<string, Score>()
  const scoreIn = (scores: Map<string, Score>, name: string) => scores.get(name) ?? (scores.set(name, new Score()), scores.get(name) as Score)

  for (const site of sites) {
    const cell = cellAt(light, site.lat, site.lon)
    if (!cell) throw new Error(`${site.name} is not in the light grid`)
    const col0 = cell.col - REACH_CELLS
    const row0 = cell.row - REACH_CELLS
    const left = -light.half_width_m + col0 * light.pixel_m
    const top = light.half_width_m - row0 * light.pixel_m
    const half = (cells * light.pixel_m) / 2
    const centre = polarLatLon(left + half, top - half)
    const pointX = (p: number) => left + ((p % side20) + 0.5) * POINT_M
    const pointY = (p: number) => top - (Math.floor(p / side20) + 0.5) * POINT_M

    // The ground, and every 20 m point's skyline and slope.
    const reach = blockReachM(custom, half * Math.SQRT2 + 2 * SLOPE_PIXEL_M)
    await loadTiles(custom, centre.lat, centre.lon, tiles, readTile, reach)
    const ground: PolarGround = { meta: custom, polarFar, block: polarBlock(custom, tiles, left + half, top - half, reach) }
    const kept = `${CACHE}skies_${site.id}_${cells}_${POINT_M}.bin`
    const masks = new Float32Array(points * AZIMUTHS)
    const heights = new Float32Array(points)
    const started = Date.now()
    if (existsSync(kept)) {
      const all = new Float32Array(arrayBuffer(readFileSync(kept)))
      masks.set(all.subarray(0, masks.length))
      heights.set(all.subarray(masks.length))
    } else {
      for (let p = 0; p < points; p += 1) {
        const found = pointHorizons(ground, pointX(p), pointY(p), [HEIGHT_M])
        masks.set(found.masks[0], p * AZIMUTHS)
        heights[p] = found.heightM
      }
      const all = new Float32Array(masks.length + heights.length)
      all.set(masks)
      all.set(heights, masks.length)
      writeFileSync(kept, new Uint8Array(all.buffer))
    }
    const skies: PointSky[] = Array.from({ length: points }, (_, p) => {
      const mask = masks.subarray(p * AZIMUTHS, (p + 1) * AZIMUTHS)
      return { ...polarLatLon(pointX(p), pointY(p)), heightM: heights[p], panelM: HEIGHT_M, antennaM: HEIGHT_M, sunMask: mask, earthMask: mask }
    })
    const flat20 = Float32Array.from({ length: points }, (_, p) => (groundSlopeDeg(ground, pointX(p), pointY(p), POINT_M) > MAX_SLOPE_DEG ? 0 : 1))
    const flatShare20 = Float32Array.from({ length: side * side }, (_, pixel) => shareOf(flat20, side20, per, pixel, side))
    console.log(`${site.name}: ${points} skylines in ${((Date.now() - started) / 1000).toFixed(0)} s`)

    // The slope, as the layer reads it: the two slope images, at the picture's pixels.
    const slopeSide = (cells * light.pixel_m) / SLOPE_PIXEL_M
    const images = slopeImages(ground, left, top, slopeSide)
    const perSlope = slopeSide / side
    // As the page reads them: the share of each pixel's own slopes under the limit.
    const pageFlat = flatShare(images.x, images.y, SLOPE_MAX, perSlope, MAX_SLOPE_DEG)
    // As it read them before this check: the images shrunk to the picture's pixels first, so one averaged slope a pixel.
    const averaged = Float32Array.from({ length: side * side }, (_, pixel) => {
      let x = 0
      let y = 0
      for (let dRow = 0; dRow < perSlope; dRow += 1) {
        for (let dCol = 0; dCol < perSlope; dCol += 1) {
          const at = (Math.floor(pixel / side) * perSlope + dRow) * slopeSide + (pixel % side) * perSlope + dCol
          x += images.x[at]
          y += images.y[at]
        }
      }
      return slopeDeg(x / (perSlope * perSlope), y / (perSlope * perSlope)) <= MAX_SLOPE_DEG ? 1 : 0
    })
    const mean = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0) / values.length
    const off = (values: Float32Array) => values.reduce((sum, value, pixel) => sum + Math.abs(value - flatShare20[pixel]), 0) / values.length
    const pct = (value: number) => (100 * value).toFixed(1)
    console.log(`  Ground under ${MAX_SLOPE_DEG} deg: ${pct(mean(flatShare20))}% by the 20 m points; ${pct(mean(pageFlat))}% by the share of each pixel's ${SLOPE_PIXEL_M} m slopes (a pixel is ${pct(off(pageFlat))} points off on average); ${pct(mean(averaged))}% by the slopes averaged to ${pixelM} m first (${pct(off(averaged))} points off).`)

    const patch = light.patches?.[site.id]
    // The site's patch as one of this square: its pixels are the truth's own points.
    const patchHere: LightPatch | null = patch && patch.sub === perCell ? { size: side20, pixel_m: patch.pixel_m, col: 0, row: 0, cells, sub: patch.sub } : null
    if (patch && (col0 < patch.col || row0 < patch.row || col0 + cells > patch.col + patch.cells || row0 + cells > patch.row + patch.cells)) throw new Error(`${site.name}: the square is not inside its patch`)

    for (const month of months) {
      const next = monthAfter(month)
      const grids = new Map<string, LightMonth>()
      const fine = new Map<string, LightMonth>()
      for (const name of [month, next]) {
        grids.set(name, squareOf(readMonth(arrayBuffer(await live(`tiles/light/${name}.bin.gz`)), light, name), col0, row0, cells))
        if (patch && patchHere) fine.set(name, squareOf(readMonth(arrayBuffer(await live(`tiles/light/patch/${site.id}/${name}.bin.gz`)), patchGrid(light, patch), name), (col0 - patch.col) * patch.sub, (row0 - patch.row) * patch.sub, side20))
      }
      const hours = light.hours[month]
      const scores = new Map<string, Score>()
      let scored = 0
      let cellSame = 0
      let patchSame = 0
      let truthFits = 0
      let cellFits = 0
      let patchFits = 0
      let landings = 0

      for (let t = 0; t < hours; t += EVERY_H) {
        landings += 1
        // The truth: the mission at every point.
        const positions = positionsFrom(Date.parse(`${month}-01T00:00:00Z`) + t * HOUR_MS, req.missionDays * 24)
        const lit = new Uint8Array(points)
        const truth = new Float32Array(points)
        for (let p = 0; p < points; p += 1) {
          const found = pointLight(skies[p], positions, req.minEarthClearanceDeg)
          const fits = (!req.sunAtLanding || found.sunAtDeg > 0) && (!req.earthAtLanding || found.earthAtDeg > 0) && found.sunGapH <= req.maxSunGapH && found.earthGapH <= req.maxEarthGapH
          lit[p] = fits ? 1 : 0
          truth[p] = fits ? flat20[p] : 0
        }
        const truthOdds = oddsField(truth, side20, POINT_M, spread)

        // The grid and the patch, as the page reads them.
        const parts = missionMonthsAt(light, month, t, req.missionDays)
        if (!parts) throw new Error('the mission runs past the grid')
        const run = startGaps(cells)
        parts.forEach((part, i) => addMonth(run, grids.get(part.month) as LightMonth, part, i === 0))
        const patchRun = patchHere ? startGaps(side20) : null
        if (patchRun) parts.forEach((part, i) => addMonth(patchRun, fine.get(part.month) as LightMonth, part, i === 0))

        const pictures = new Map<string, Float32Array>()
        for (const [slopeName, flat] of [["the truth's slope", flatShare20], ["the page's slope", pageFlat]] as const) {
          pictures.set(`the 120 m grid alone, ${slopeName}`, oddsField(fitField(run, req, SUB, flat, true), side, pixelM, spread))
          if (patchHere && patchRun) {
            const laid = fitField(run, req, SUB, flat, true)
            layPatch(laid, SUB, cells, patchHere, patchRun, req, flat)
            pictures.set(`the 20 m patch laid in, ${slopeName}`, oddsField(laid, side, pixelM, spread))
          }
        }
        // The best a picture of these pixels can do: the truth itself, a pixel at a time.
        const best = Float32Array.from({ length: side * side }, (_, pixel) => shareOf(truth, side20, per, pixel, side))
        pictures.set("the points themselves, at the picture's pixels", oddsField(best, side, pixelM, spread))

        // Score the middle of the square.
        for (let row = EDGE_CELLS * SUB; row < side - EDGE_CELLS * SUB; row += 1) {
          for (let col = EDGE_CELLS * SUB; col < side - EDGE_CELLS * SUB; col += 1) {
            // A pixel is aimed at its own middle: the middle one of the 20 m points it covers.
            const aim = (row * per + (per - 1) / 2) * side20 + col * per + (per - 1) / 2
            for (const [name, picture] of pictures) {
              scoreIn(scores, name).add(picture[row * side + col], truthOdds[aim])
              scoreIn(total, name).add(picture[row * side + col], truthOdds[aim])
            }
          }
        }
        // The ground itself, the Sun and Earth alone: each 20 m point against the cell, and the patch pixel, that holds it.
        for (let row = EDGE_CELLS * perCell; row < side20 - EDGE_CELLS * perCell; row += 1) {
          for (let col = EDGE_CELLS * perCell; col < side20 - EDGE_CELLS * perCell; col += 1) {
            const p = row * side20 + col
            const byCell = lightVerdict(run, Math.floor(row / perCell) * cells + Math.floor(col / perCell), req) === FITS
            scored += 1
            if (lit[p] === 1) truthFits += 1
            if (byCell) cellFits += 1
            if (byCell === (lit[p] === 1)) cellSame += 1
            if (patchRun) {
              const byPatch = lightVerdict(patchRun, p, req) === FITS
              if (byPatch) patchFits += 1
              if (byPatch === (lit[p] === 1)) patchSame += 1
            }
          }
        }
      }

      const share = (count: number) => `${((100 * count) / scored).toFixed(1)}%`
      console.log(`  ${month}, ${landings} landings. Sun and Earth alone, 20 m point by point: the points say ${share(truthFits)} of the ground fits; the 120 m cells say ${share(cellFits)} and agree with the point on ${share(cellSame)}${patchHere ? `; the patch says ${share(patchFits)} and agrees on ${share(patchSame)}` : ''}.`)
      for (const [name, score] of scores) console.log(`    ${name.padEnd(50)} ${score.words()}`)
    }
    console.log('')
  }
  console.log('All sites and months:')
  for (const [name, score] of total) console.log(`    ${name.padEnd(50)} ${score.words()}`)
}

await main()
