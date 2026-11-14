import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Cell, cellAt, type LightMeta, type LightMetaFile, lightMeta, readMonth, type Spot, spotAt, wideGrid } from '../../src/lib/lightGrid'
import type { Bucket } from '../bucket'

/**
 * The light grids for the co-pilot: Sun and Earth visibility at one pixel near the south pole, for
 * one month (see `pipeline/src/clps/lightgrid.py` and `src/lib/lightGrid.ts`): the fine grid where
 * it reaches, the wide one around it. The month files live in the assets bucket. A month is 42 MB
 * unpacked, more than this server should hold, so a lookup unpacks the file as a stream and keeps
 * only the pixel asked about and the eight around it.
 */
export type SpotLookup =
  | { ok: true; meta: LightMeta; cell: Cell; spot: Spot }
  /** unavailable: no grid in this build, or its files can't be read. outside: not in the grid's square. */
  | { ok: false; why: 'unavailable' | 'outside' | 'no-month' }

export interface LightSource {
  spot(lat: number, lon: number, month: string): Promise<SpotLookup>
}

/** Packed month files kept in memory: about 3.4 MB each. */
const MAX_KEPT_MONTHS = 3

/**
 * The 16-bit values at the given positions of a little-endian stream, in the order asked for.
 * `positions` are value indexes (not byte offsets) and must be in ascending order.
 */
export async function pickValues(chunks: AsyncIterable<Uint8Array>, positions: number[]): Promise<Uint16Array> {
  const picked = new Uint16Array(positions.length)
  let next = 0
  let offset = 0
  /** The low byte of a value whose two bytes fall in different chunks. */
  let carried: number | null = null
  for await (const chunk of chunks) {
    while (next < positions.length) {
      const at = positions[next] * 2 - offset
      if (carried !== null) {
        picked[next] = carried | (chunk[0] << 8)
        carried = null
        next += 1
      } else if (at + 1 < chunk.length) {
        picked[next] = chunk[at] | (chunk[at + 1] << 8)
        next += 1
      } else if (at < chunk.length) {
        carried = chunk[at]
        break
      } else break
    }
    offset += chunk.length
    if (next === positions.length) break
  }
  if (next < positions.length) throw new Error('the month file is shorter than the grid')
  return picked
}

/** The pixel and the eight around it, row by row; a neighbour off the grid's edge is the pixel itself. */
function neighbourhood(cell: Cell, size: number): number[] {
  const cells: number[] = []
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const col = cell.col + dCol
      const row = cell.row + dRow
      const inside = col >= 0 && row >= 0 && col < size && row < size
      cells.push(inside ? row * size + col : cell.row * size + cell.col)
    }
  }
  return cells
}

async function gzipped(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(body).arrayBuffer())
}

/** The light grid read from the pipeline's output: its description from `dataDir`, its months from the bucket. */
export function bucketLight(bucket: Bucket | null, dataDir: string): LightSource {
  let meta: Promise<LightMeta | null> | null = null
  const months = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>()

  const loadMeta = () => {
    meta ??= readFile(join(dataDir, 'light', 'meta.json'), 'utf8')
      .then((text) => lightMeta(JSON.parse(text) as LightMetaFile))
      .catch(() => null)
    return meta
  }
  const loadMonth = (key: string) => {
    let found = months.get(key)
    if (found) months.delete(key)
    else {
      found = bucket ? bucket.get(key).then((object) => (object ? gzipped(object.body) : null)) : Promise.resolve(null)
      found.catch(() => months.delete(key))
    }
    months.set(key, found)
    if (months.size > MAX_KEPT_MONTHS) months.delete(months.keys().next().value as string)
    return found
  }

  return {
    async spot(lat, lon, month) {
      const fine = await loadMeta()
      if (!fine) return { ok: false, why: 'unavailable' }
      // The fine grid where it reaches; outside it, the wide grid if this build has one.
      const wider = wideGrid(fine)
      const inFine = cellAt(fine, lat, lon)
      const grid = inFine || !wider ? fine : wider
      const cell = inFine ?? (wider ? cellAt(wider, lat, lon) : null)
      if (!cell) return { ok: false, why: 'outside' }
      // Months are named by the grid's own list, so the name is safe to put in a path.
      if (grid.hours[month] === undefined) return { ok: false, why: 'no-month' }
      const packed = await loadMonth(`tiles/light/${grid === fine ? '' : 'wide/'}${month}.bin.gz`).catch(() => null)
      if (!packed) return { ok: false, why: 'unavailable' }

      const cells = grid.size * grid.size
      const around = neighbourhood(cell, grid.size)
      const slots = grid.sun_slots + grid.earth_slots
      // Every slot of every one of the nine pixels, in the order the file holds them.
      const wanted = Array.from({ length: slots * 9 }, (_, i) => ({ i, at: Math.floor(i / 9) * cells + around[i % 9] })).sort((a, b) => a.at - b.at)
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))
      let values: Uint16Array
      try {
        values = await pickValues(stream as unknown as AsyncIterable<Uint8Array>, wanted.map((item) => item.at))
      } catch {
        return { ok: false, why: 'unavailable' }
      }
      // The nine pixels as a 3 x 3 grid of their own, laid out like a month file, with the pixel in the middle.
      const small = new Uint16Array(slots * 9)
      wanted.forEach((item, n) => {
        small[item.i] = values[n]
      })
      const mini = readMonth(small.buffer, { ...grid, size: 3 }, month)
      return { ok: true, meta: grid, cell, spot: spotAt(mini, { col: 1, row: 1 }) }
    },
  }
}

/** For builds and tests with no light grid. */
export const noLight: LightSource = { spot: async () => ({ ok: false, why: 'unavailable' }) }
