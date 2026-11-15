import type { SlopeImages } from '../data/loadMissionGrid'
import type { ShadeAnswer, ShadeAsk } from './shadeWorker'

/**
 * The page's side of the shade worker: asks for a picture, and gets it back as a canvas the globe
 * can take. The worker is started the first time a picture is asked for.
 */

type Body = ShadeAsk extends infer Ask ? (Ask extends { id: number } ? Omit<Ask, 'id'> : never) : never

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (answer: ShadeAnswer) => void>()

function ask(body: Body, transfer: Transferable[] = []): Promise<ShadeAnswer> {
  if (!worker) {
    worker = new Worker(new URL('./shadeWorker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<ShadeAnswer>) => {
      waiting.get(event.data.id)?.(event.data)
      waiting.delete(event.data.id)
    })
    worker.addEventListener('error', (event) => {
      // A worker that cannot run answers nothing: everyone waiting is told there is no picture.
      console.error(event.message)
      for (const [id, tell] of waiting) tell({ id, width: 0, height: 0, pixels: null })
      waiting.clear()
    })
  }
  const id = nextId
  nextId += 1
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker?.postMessage({ ...body, id }, transfer)
  })
}

function canvasOf(answer: ShadeAnswer): HTMLCanvasElement | null {
  if (!answer.pixels) return null
  const image = document.createElement('canvas')
  image.width = answer.width
  image.height = answer.height
  const context = image.getContext('2d')
  if (!context) return null
  context.putImageData(new ImageData(new Uint8ClampedArray(answer.pixels), answer.width, answer.height), 0, 0)
  return image
}

/** Give the worker the whole grid's slope images: once, before the first polar picture. They are handed over, not copied: the page has no other use for them. */
export function giveSlope(slope: SlopeImages | null): Promise<void> {
  return ask({ kind: 'slope', slope }, slope ? [slope.x.buffer, slope.y.buffer] : []).then(() => undefined)
}

/** The polar picture for a landing, or null when the mission runs past the grid. */
export function polarPicture(body: Omit<Extract<ShadeAsk, { kind: 'polar' }>, 'id' | 'kind'>): Promise<HTMLCanvasElement | null> {
  return ask({ kind: 'polar', ...body }).then(canvasOf)
}

/** The wide grid's picture for a landing, or null when there is no wide grid, it could not be read, or the mission runs past it. */
export function widePicture(body: Omit<Extract<ShadeAsk, { kind: 'wide' }>, 'id' | 'kind'>): Promise<HTMLCanvasElement | null> {
  return ask({ kind: 'wide', ...body }).then(canvasOf)
}

/** The whole Moon's picture for a landing, or null when the mission runs past the year's positions. */
export function washPicture(body: Omit<Extract<ShadeAsk, { kind: 'wash' }>, 'id' | 'kind'>): Promise<HTMLCanvasElement | null> {
  return ask({ kind: 'wash', ...body }).then(canvasOf)
}

/** A picture kept for a moment and a setting: `sign` names everything but the hour that it depends on. */
export interface Frame {
  sign: string
  hour: number
  /** Null when there is no picture for this moment (past the data). */
  picture: HTMLCanvasElement | null
}

/**
 * Which two pictures to blend for an hour, and how far between them it is. The hour's own picture
 * if there is one. Otherwise the two key frames either side of it, `everyH` hours apart, or the
 * one of them there is. Failing those, the nearest picture at all, so the Moon never goes bare
 * while one is on the way. Null with no picture of any kind.
 */
export function pickFrames(frames: Frame[], sign: string, hour: number, everyH: number): { from: HTMLCanvasElement; to: HTMLCanvasElement; mix: number } | null {
  const mine = frames.filter((frame) => frame.sign === sign && frame.picture)
  const at = (wanted: number) => mine.find((frame) => frame.hour === wanted)?.picture ?? null
  const exact = at(hour)
  if (exact) return { from: exact, to: exact, mix: 0 }
  const before = Math.floor(hour / everyH) * everyH
  const from = at(before)
  const to = at(before + everyH)
  if (from && to) return { from, to, mix: (hour - before) / everyH }
  const one = from ?? to
  if (one) return { from: one, to: one, mix: 0 }
  // Nothing for this hour yet: the nearest in time, of this setting first and of any setting after.
  const nearest = (among: Frame[]) => among.reduce<Frame | null>((best, frame) => (!best || Math.abs(frame.hour - hour) < Math.abs(best.hour - hour) ? frame : best), null)?.picture ?? null
  const held = nearest(mine) ?? nearest(frames.filter((frame) => frame.picture))
  return held ? { from: held, to: held, mix: 0 } : null
}

/**
 * The next picture worth asking for: the hour's own once the time bar rests, then the key frame
 * before it and the one after. Null when all of them are on hand (or known not to exist).
 */
export function nextWanted(frames: Frame[], sign: string, hour: number, everyH: number, rested: boolean): number | null {
  const has = (wanted: number) => frames.some((frame) => frame.sign === sign && frame.hour === wanted)
  const before = Math.floor(hour / everyH) * everyH
  for (const wanted of [...(rested ? [hour] : []), before, before + everyH]) if (!has(wanted)) return wanted
  return null
}

/** Keep a new frame, and let go of the oldest past `limit`: each polar picture is sixteen megabytes. */
export function keepFrame(frames: Frame[], frame: Frame, limit: number): void {
  frames.push(frame)
  while (frames.length > limit) frames.shift()
}
