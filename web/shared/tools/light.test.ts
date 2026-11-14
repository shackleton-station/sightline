import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { cellCenter, type LightMeta, readMonth, spotAt } from '../../src/lib/lightGrid'
import type { Bucket } from '../bucket'
import { bucketLight, pickValues } from './light'

async function* inChunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size)
}

describe('pickValues', () => {
  const values = Uint16Array.from({ length: 200 }, (_, i) => (i * 257 + 3) & 0xffff)
  const bytes = new Uint8Array(values.buffer)

  it('reads the values asked for, however the stream is cut up', async () => {
    const wanted = [0, 1, 7, 8, 63, 64, 150, 199]
    for (const size of [1, 2, 3, 15, 16, 17, 128, 4096]) {
      expect([...(await pickValues(inChunks(bytes, size), wanted))]).toEqual(wanted.map((i) => values[i]))
    }
  })

  it('says so when the stream ends before a value', async () => {
    await expect(pickValues(inChunks(bytes.subarray(0, 100), 16), [10, 60])).rejects.toThrow(/shorter/)
  })
})

/** A small grid laid out like the real one, with made-up flips for every cell. */
const META: LightMeta = {
  size: 8,
  pixel_m: 120,
  half_width_m: 480,
  radius_m: 1737400,
  x_axis_lon_deg: 90,
  y_axis_lon_deg: 0,
  obs_height_m: 2,
  sun_slots: 16,
  earth_slots: 4,
  hours: { '2027-05': 744 },
}
const CELLS = META.size * META.size
/** The grid as the pipeline writes it: its months named by their first and last, not listed. */
const { hours: _listed, ...SHAPE } = META
const META_FILE = { ...SHAPE, first_month: '2027-05', last_month: '2027-05' }

function madeUpMonth(): Uint16Array {
  const all = new Uint16Array(CELLS * 20).fill(744)
  for (let cell = 0; cell < CELLS; cell++) {
    // The Sun up from an hour that depends on the cell to another; Earth up from hour 0 on even cells.
    all[cell] = (cell * 7) % 300
    all[CELLS + cell] = 300 + ((cell * 13) % 400)
    if (cell % 2 === 0) all[16 * CELLS + cell] = 0
  }
  return all
}

function setUp(objects: Record<string, Uint8Array>) {
  const dataDir = mkdtempSync(join(tmpdir(), 'light-'))
  mkdirSync(join(dataDir, 'light'))
  writeFileSync(join(dataDir, 'light', 'meta.json'), JSON.stringify(META_FILE))
  const get = vi.fn<Bucket['get']>(async (key) => {
    const bytes = objects[key]
    return bytes ? { status: 200, body: new Blob([new Uint8Array(bytes)]).stream(), length: String(bytes.length), contentRange: null, etag: null } : null
  })
  return { dataDir, bucket: { get }, get }
}

describe('the light grid, read from the bucket', () => {
  const month = madeUpMonth()
  const packed = gzipSync(new Uint8Array(month.buffer))
  const whole = readMonth(month.buffer.slice(0) as ArrayBuffer, META, '2027-05')

  it('gives the same answer for a pixel as reading the whole month does, edges and corners included', async () => {
    const { dataDir, bucket } = setUp({ 'tiles/light/2027-05.bin.gz': packed })
    const light = bucketLight(bucket, dataDir)
    for (const cell of [{ col: 3, row: 4 }, { col: 0, row: 0 }, { col: 7, row: 2 }, { col: 5, row: 7 }]) {
      const { lat, lon } = cellCenter(META, cell)
      const found = await light.spot(lat, lon, '2027-05')
      const expected = spotAt(whole, cell)
      expect(found.ok && found.cell).toEqual(cell)
      expect(found.ok && found.spot.numbers).toEqual(expected.numbers)
      expect(found.ok && found.spot.nearby).toEqual(expected.nearby)
      expect(found.ok && [...found.spot.sun]).toEqual([...expected.sun])
    }
  })

  it('reads the wide grid for ground outside the fine square, and says which pixel size it is', async () => {
    // A wide grid of the same shape with pixels three times the size, in its own file.
    const dataDir = mkdtempSync(join(tmpdir(), 'light-'))
    mkdirSync(join(dataDir, 'light'))
    const wide = { size: 8, pixel_m: 360, half_width_m: 1440 }
    writeFileSync(join(dataDir, 'light', 'meta.json'), JSON.stringify({ ...META_FILE, wide: { ...wide, first_month: '2027-05', last_month: '2027-05' } }))
    const other = madeUpMonth().map((value, i) => (i < CELLS ? (value + 11) % 300 : value))
    const files: Record<string, Uint8Array> = { 'tiles/light/2027-05.bin.gz': packed, 'tiles/light/wide/2027-05.bin.gz': gzipSync(new Uint8Array(other.buffer)) }
    const get = vi.fn<Bucket['get']>(async (key) => (files[key] ? { status: 200, body: new Blob([new Uint8Array(files[key])]).stream(), length: null, contentRange: null, etag: null } : null))
    const light = bucketLight({ get }, dataDir)
    const wideMeta = { ...META, ...wide }
    const wholeWide = readMonth(other.buffer.slice(0) as ArrayBuffer, wideMeta, '2027-05')

    // A pixel in the wide grid's corner is well outside the fine square.
    const far = cellCenter(wideMeta, { col: 0, row: 7 })
    const found = await light.spot(far.lat, far.lon, '2027-05')
    expect(found.ok && found.meta.pixel_m).toBe(360)
    expect(found.ok && found.cell).toEqual({ col: 0, row: 7 })
    expect(found.ok && found.spot.numbers).toEqual(spotAt(wholeWide, { col: 0, row: 7 }).numbers)
    expect(get).toHaveBeenLastCalledWith('tiles/light/wide/2027-05.bin.gz')

    // Ground both grids hold is answered from the fine one.
    const near = cellCenter(META, { col: 3, row: 4 })
    const inner = await light.spot(near.lat, near.lon, '2027-05')
    expect(inner.ok && inner.meta.pixel_m).toBe(120)
    expect(inner.ok && inner.spot.numbers).toEqual(spotAt(whole, { col: 3, row: 4 }).numbers)
  })

  it('fetches a month once, however many pixels are asked about', async () => {
    const { dataDir, bucket, get } = setUp({ 'tiles/light/2027-05.bin.gz': packed })
    const light = bucketLight(bucket, dataDir)
    const { lat, lon } = cellCenter(META, { col: 2, row: 2 })
    await light.spot(lat, lon, '2027-05')
    await light.spot(lat, lon, '2027-05')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('says why it cannot answer', async () => {
    const { dataDir, bucket } = setUp({})
    const { lat, lon } = cellCenter(META, { col: 2, row: 2 })
    expect(await bucketLight(bucket, dataDir).spot(0.67, 23.47, '2027-05')).toEqual({ ok: false, why: 'outside' })
    expect(await bucketLight(bucket, dataDir).spot(lat, lon, '2051-01')).toEqual({ ok: false, why: 'no-month' })
    // The month is listed, but its file isn't in the bucket.
    expect(await bucketLight(bucket, dataDir).spot(lat, lon, '2027-05')).toEqual({ ok: false, why: 'unavailable' })
    // No description of the grid at all.
    expect(await bucketLight(bucket, join(dataDir, 'nowhere')).spot(lat, lon, '2027-05')).toEqual({ ok: false, why: 'unavailable' })
    // A file that isn't this grid.
    const short = setUp({ 'tiles/light/2027-05.bin.gz': gzipSync(new Uint8Array(100)) })
    expect(await bucketLight(short.bucket, short.dataDir).spot(lat, lon, '2027-05')).toEqual({ ok: false, why: 'unavailable' })
  })
})
