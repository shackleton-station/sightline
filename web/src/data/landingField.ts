import { nearResolutionM, polarLatLon, polarXY } from '../lib/customModel'
import { type LandingField, type Lattice, latticePointM, latticeReachM, pointLight, type PointSky, slopeLatticeFor } from '../lib/landingField'
import { groundSlopeDeg, pointHorizons, type PolarGround, reachesPolarMaps } from '../lib/pointHorizons'
import { loadCustomMeta, loadPolarGround, loadYearPositions } from './customSite'
import type { HorizonAnswer, HorizonJob } from './horizonWorker'

/**
 * The landing points around a target, worked out in the browser for the Landing accuracy panel
 * and for the odds under the verdict (`lib/landingField.ts`). A point's skyline is the costly part
 * and depends only on where the point is and how high the panel and antenna stand, so skylines are
 * kept: another date, mission or Earth clearance at the same target only reads the hours again.
 */

/** What a field is asked for. */
export interface FieldAsk {
  /** The target. */
  lat: number
  lon: number
  /** Where the Sun and Earth are looked for from, above the ground (m). */
  panelM: number
  antennaM: number
  /** The landing: hours after `startIso`, and how long the mission runs. */
  startIso: string
  landing: number
  missionDays: number
  /** How far Earth's center must be above the skyline to count (degrees); 0 for any part of it. */
  clearanceDeg: number
  lattice: Lattice
}

/**
 * 'past': the mission runs outside the years there are Sun and Earth positions for. 'outside': the
 * target is too far from the south pole for the polar terrain to hold every skyline.
 */
export type FieldAnswer = { state: 'ready'; field: LandingField } | { state: 'past' } | { state: 'outside' }

/** The part of an ask that names the place and the mission: two asks alike in this differ only in their lattice. */
export function placeKey(ask: FieldAsk): string {
  return [ask.lat, ask.lon, ask.panelM, ask.antennaM, ask.startIso, ask.landing, ask.missionDays, ask.clearanceDeg].join(',')
}

export function fieldKey(ask: FieldAsk): string {
  return `${placeKey(ask)}|${ask.lattice.n}x${ask.lattice.stepM}`
}

const HOUR_MS = 3_600_000
/** Skylines kept: each is two masks of 720 numbers, about 6 kB. */
const SKIES_KEPT = 3000
const FIELDS_KEPT = 24
/** How long the page's thread is held before it is given back, and how often progress is told (ms). */
const SLICE_MS = 24
const TELL_MS = 120

const skies = new Map<string, PointSky>()
const answers = new Map<string, FieldAnswer>()
const requests = new Map<string, Promise<FieldAnswer>>()
const progress = new Map<string, number>()
const watchers = new Set<() => void>()
/** One field at a time: each is seconds of sums on the page's own thread. */
let queue: Promise<unknown> = Promise.resolve()

const tell = () => {
  for (const watcher of watchers) watcher()
}

/** Be told when a field's progress changes; returns the way to stop. */
export function watchFields(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

/** A field already worked out, without waiting; undefined if it is not. */
export function fieldNow(ask: FieldAsk): FieldAnswer | undefined {
  return answers.get(fieldKey(ask))
}

/** How much of a field being worked out is done, from 0 to 1. */
export function fieldProgress(ask: FieldAsk): number {
  return progress.get(fieldKey(ask)) ?? 0
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve))

/** The Sun's and Earth's positions for each hour of a mission from its landing, six numbers an hour; null outside the years there are. */
async function missionPositions(ask: FieldAsk, firstMs: number, hoursHeld: number): Promise<Float32Array | null> {
  const hours = ask.missionDays * 24
  const landingMs = Date.parse(ask.startIso) + ask.landing * HOUR_MS
  if (landingMs < firstMs || landingMs + hours * HOUR_MS > firstMs + hoursHeld * HOUR_MS) return null
  const positions = new Float32Array(hours * 6)
  const firstYear = new Date(landingMs).getUTCFullYear()
  const lastYear = new Date(landingMs + (hours - 1) * HOUR_MS).getUTCFullYear()
  for (let year = firstYear; year <= lastYear; year += 1) {
    const held = await loadYearPositions(year)
    const yearMs = Date.UTC(year, 0, 1)
    // The mission's hours that fall in this year, and where they start in the year's file.
    const from = Math.max(0, Math.round((yearMs - landingMs) / HOUR_MS))
    const to = Math.min(hours, Math.round((Date.UTC(year + 1, 0, 1) - landingMs) / HOUR_MS))
    const at = Math.round((landingMs + from * HOUR_MS - yearMs) / HOUR_MS)
    if ((at + to - from) * 6 > held.length) return null
    positions.set(held.subarray(at * 6, (at + to - from) * 6), from * 6)
  }
  return positions
}

/** The workers skylines are worked out on, started the first time they are needed; empty where a worker cannot be started. */
let pool: Worker[] | null = null
let nextJob = 1
const jobs = new Map<number, { take: (answer: HorizonAnswer) => void; fail: (reason: unknown) => void }>()

function workers(): Worker[] {
  if (pool) return pool
  pool = []
  if (typeof Worker === 'undefined') return pool
  // A few, leaving the page's own thread and one more core free.
  const count = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 2))
  try {
    for (let i = 0; i < count; i += 1) {
      const worker = new Worker(new URL('./horizonWorker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<HorizonAnswer>) => jobs.get(event.data.job)?.take(event.data))
      worker.addEventListener('error', (event) => {
        // A worker that cannot run answers nothing: every job is told, and the page's own thread does the work from here on.
        console.error(event.message)
        pool = []
        for (const job of jobs.values()) job.fail(new Error('the skyline worker stopped'))
        jobs.clear()
      })
      pool.push(worker)
    }
  } catch (reason) {
    console.error(reason)
    pool = []
  }
  return pool
}

/** Some points' skylines from one worker; `each` is told as each point arrives. */
function askWorker(worker: Worker, ground: PolarGround, points: Float64Array, heightsM: number[], each: (index: number, answer: HorizonAnswer) => void): Promise<void> {
  const job = nextJob
  nextJob += 1
  return new Promise((resolve, reject) => {
    jobs.set(job, {
      take: (answer) => {
        each(answer.index, answer)
        if (answer.done) {
          jobs.delete(job)
          resolve()
        }
      },
      fail: reject,
    })
    worker.postMessage({ job, ground, points, heightsM } satisfies HorizonJob)
  })
}

/** The skylines at every point of a lattice around a map-plane point, from those kept and the rest worked out now. */
async function skiesAround(ground: PolarGround, x: number, y: number, ask: FieldAsk, key: string): Promise<PointSky[]> {
  const points = ask.lattice.n * ask.lattice.n
  const heights = ask.panelM === ask.antennaM ? [ask.panelM] : [ask.panelM, ask.antennaM]
  const found = new Array<PointSky>(points)
  const missing: { index: number; x: number; y: number; name: string }[] = []
  for (let index = 0; index < points; index += 1) {
    const offset = latticePointM(ask.lattice, index)
    const px = x + offset.x
    const py = y + offset.y
    const name = `${px.toFixed(1)},${py.toFixed(1)},${ask.panelM},${ask.antennaM}`
    const sky = skies.get(name)
    if (sky) found[index] = sky
    else missing.push({ index, x: px, y: py, name })
  }
  let done = points - missing.length
  let told = performance.now()
  const keep = (point: (typeof missing)[number], heightM: number, masks: Float32Array[]) => {
    const sky = { ...polarLatLon(point.x, point.y), heightM, panelM: ask.panelM, antennaM: ask.antennaM, sunMask: masks[0], earthMask: masks[heights.length - 1] }
    if (skies.size >= SKIES_KEPT) skies.delete(skies.keys().next().value as string)
    skies.set(point.name, sky)
    found[point.index] = sky
    done += 1
    progress.set(key, done / points)
    const now = performance.now()
    if (now - told > TELL_MS) {
      told = now
      tell()
    }
  }
  const crew = missing.length > 0 ? workers() : []
  if (crew.length > 0) {
    try {
      // Each worker takes every `crew.length`-th point, so they finish together and the middle fills in evenly.
      await Promise.all(
        crew.map((worker, w) => {
          const mine = missing.filter((_, i) => i % crew.length === w)
          if (mine.length === 0) return undefined
          return askWorker(worker, ground, Float64Array.from(mine.flatMap((point) => [point.x, point.y])), heights, (index, answer) => keep(mine[index], answer.heightM, answer.masks))
        }),
      )
      return found
    } catch (reason) {
      console.error(reason)
    }
  }
  // No worker: the page's own thread, a slice at a time.
  let sliceFrom = performance.now()
  for (const point of missing) {
    if (found[point.index]) continue
    const { heightM, masks } = pointHorizons(ground, point.x, point.y, heights)
    keep(point, heightM, masks)
    if (performance.now() - sliceFrom > SLICE_MS) {
      await pause()
      sliceFrom = performance.now()
    }
  }
  return found
}

async function workOut(ask: FieldAsk, key: string): Promise<FieldAnswer> {
  const meta = await loadCustomMeta()
  const { x, y } = polarXY(ask.lat, ask.lon)
  const reach = latticeReachM(ask.lattice)
  const halfStepM = nearResolutionM(meta, ask.lat, ask.lon)
  // The slope reads the ground half a step past the outermost point.
  const around = reach * Math.SQRT2 + halfStepM + meta.polar.res_m
  if (ask.lat >= 0 || !reachesPolarMaps(meta, x, y, around)) return { state: 'outside' }
  const positions = await missionPositions(ask, Date.parse(meta.start), meta.hours)
  if (!positions) return { state: 'past' }
  const ground = await loadPolarGround(ask.lat, ask.lon, around)
  const found = await skiesAround(ground, x, y, ask, key)
  const points = found.length
  const field: LandingField = {
    lattice: ask.lattice,
    sunAtDeg: new Float32Array(points),
    earthAtDeg: new Float32Array(points),
    sunGapH: new Float32Array(points),
    earthGapH: new Float32Array(points),
    slope: slopeLatticeFor(ask.lattice, meta.polar.res_m),
    slopeDeg: new Float32Array(0),
  }
  let sliceFrom = performance.now()
  for (let index = 0; index < points; index += 1) {
    const light = pointLight(found[index], positions, ask.clearanceDeg)
    field.sunAtDeg[index] = light.sunAtDeg
    field.earthAtDeg[index] = light.earthAtDeg
    field.sunGapH[index] = light.sunGapH
    field.earthGapH[index] = light.earthGapH
    if (performance.now() - sliceFrom > SLICE_MS) {
      await pause()
      sliceFrom = performance.now()
    }
  }
  field.slopeDeg = Float32Array.from({ length: field.slope.n * field.slope.n }, (_, index) => {
    const offset = latticePointM(field.slope, index)
    return groundSlopeDeg(ground, x + offset.x, y + offset.y, halfStepM)
  })
  return { state: 'ready', field }
}

/** The field for an ask: worked out once, then kept. A failure (the terrain could not be read) is not kept, so asking again tries again. */
export function loadLandingField(ask: FieldAsk): Promise<FieldAnswer> {
  const key = fieldKey(ask)
  const known = requests.get(key)
  if (known) return known
  const request = queue.then(() => workOut(ask, key))
  queue = request.catch(() => undefined)
  requests.set(key, request)
  request.then(
    (answer) => {
      if (answers.size >= FIELDS_KEPT) {
        const oldest = answers.keys().next().value as string
        answers.delete(oldest)
        requests.delete(oldest)
      }
      answers.set(key, answer)
      progress.delete(key)
      tell()
    },
    () => {
      requests.delete(key)
      progress.delete(key)
    },
  )
  return request
}
