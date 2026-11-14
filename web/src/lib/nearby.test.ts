/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { NearbyMeta, SiteInfo, Summary } from '../data/contract'
import { polarXY } from './customModel'
import {
  bestSpots,
  cellAt,
  cellDistanceM,
  cellLatLon,
  cellOffsetM,
  cellValue,
  centerCell,
  decodeNearbyMonth,
  goodnessPct,
  largestGapH,
  nearbyAnchor,
  type NearbyMonth,
  shareWithinSlope,
  valueRange,
  withinSlope,
} from './nearby'

/** A 5 × 5 map with 100 m cells around the point used by nearbyAnchor's tests. */
const meta = {
  site_id: 'test',
  half_width_m: 200,
  step_m: 100,
  size: 5,
  center_x_m: 10_000,
  center_y_m: 20_000,
  corner: { lat: 0, lon: 0 },
  slope_baseline_m: 40,
  slope_quant_deg: 0.5,
  obs_height_m: 2,
} as NearbyMeta

function month(both: number[]): NearbyMonth {
  return {
    sun: Uint8Array.from(both.map((v) => Math.min(100, v + 10))),
    earth: Uint8Array.from(both.map(() => 50)),
    both: Uint8Array.from(both),
    sunGapH: Uint16Array.from(both.map((v) => 100 - v)),
  }
}
const flat = new Uint8Array(25)

describe('decodeNearbyMonth', () => {
  it('reads the planes, including a gap plane that starts on an odd byte', () => {
    const bytes = new Uint8Array([1, 2, 3, 300 & 255, 300 >> 8])
    const out = decodeNearbyMonth(bytes.buffer, 1)
    expect([out.sun[0], out.earth[0], out.both[0], out.sunGapH[0]]).toEqual([1, 2, 3, 300])
  })

  it('refuses a file of the wrong size', () => {
    expect(() => decodeNearbyMonth(new ArrayBuffer(4), 1)).toThrow('expected 5 bytes')
  })
})

describe('cell geometry', () => {
  it('puts the site in the middle, and rows from the top', () => {
    expect(centerCell(meta)).toBe(12)
    expect(cellOffsetM(meta, 12)).toEqual({ x: 0, y: 0 })
    expect(cellOffsetM(meta, 0)).toEqual({ x: -200, y: 200 })
    expect(cellOffsetM(meta, 24)).toEqual({ x: 200, y: -200 })
    expect(cellDistanceM(meta, 13)).toBe(100)
  })

  it('finds the cell at a point, and nothing outside the map', () => {
    const place = cellLatLon(meta, 3)
    expect(cellAt(meta, place.lat, place.lon)).toBe(3)
    const outside = cellLatLon({ ...meta, center_x_m: 11_000 }, 12)
    expect(cellAt(meta, outside.lat, outside.lon)).toBeNull()
  })
})

describe('nearbyAnchor', () => {
  const site = (id: string, lat: number, lon: number, half?: number) =>
    ({ id, name: id, lat, lon, source_url: '', group: 'x', nearby_half_m: half }) as SiteInfo
  const ridge = site('ridge', -89, 10, 5_000)
  const other = site('other', -88.9, 10, 5_000)
  const apollo = site('apollo', 0.7, 23)

  it('is the site itself when it has a map', () => {
    expect(nearbyAnchor(ridge, [ridge, other])).toBe(ridge)
  })

  it('is the closest map that covers a custom point', () => {
    expect(nearbyAnchor(site('custom', -88.99, 10), [ridge, other, apollo])).toBe(ridge)
    expect(nearbyAnchor(site('custom', -88.91, 10), [ridge, other, apollo])).toBe(other)
  })

  it('is nothing away from every map', () => {
    expect(nearbyAnchor(apollo, [ridge, other, apollo])).toBeNull()
    expect(nearbyAnchor(site('custom', -85, 10), [ridge, other])).toBeNull()
  })
})

describe('goodnessPct', () => {
  it('uses percent as is', () => {
    expect(goodnessPct('both', 42, 100)).toBe(42)
  })

  it('makes fewer hours without Sun look better', () => {
    expect(goodnessPct('sunGap', 0, 100)).toBe(100)
    expect(goodnessPct('sunGap', 100, 100)).toBe(0)
    expect(goodnessPct('sunGap', 0, 0)).toBe(100)
  })
})

describe('slope limits', () => {
  const slope = Uint8Array.from([0, 10, 20, 40])

  it('compares degrees, in stored steps', () => {
    expect(withinSlope(slope, 0.5, 1, 5)).toBe(true)
    expect(withinSlope(slope, 0.5, 2, 5)).toBe(false)
    expect(withinSlope(slope, 0.5, 3, null)).toBe(true)
  })

  it('finds the share of gentle ground', () => {
    expect(shareWithinSlope(slope, 0.5, 5)).toBe(50)
  })
})

describe('valueRange', () => {
  it('skips ground that is too steep, and says when nothing is left', () => {
    const data = month([...new Array<number>(24).fill(10), 90])
    const steep = new Uint8Array(25)
    steep[24] = 100
    expect(valueRange(data, 'both', steep, 0.5, 10)).toEqual({ low: 10, high: 10 })
    expect(valueRange(data, 'both', steep, 0.5, null)).toEqual({ low: 10, high: 90 })
    expect(valueRange(data, 'both', steep.fill(100), 0.5, 10)).toBeNull()
  })
})

describe('bestSpots', () => {
  const values = new Array<number>(25).fill(10)

  it('lists only places better than the site, best first', () => {
    const data = month(values.map((_, i) => (i === 0 ? 40 : i === 24 ? 60 : i === 12 ? 30 : 10)))
    expect(bestSpots(meta, data, 'both', flat, null, 5)).toEqual([24, 0])
  })

  it('treats close neighbours as one place', () => {
    const data = month(values.map((_, i) => (i === 0 ? 60 : i === 1 ? 59 : i === 24 ? 50 : 10)))
    expect(bestSpots(meta, data, 'both', flat, null, 5)).toEqual([0, 24])
  })

  it('takes the nearest when values tie', () => {
    const data = month(values.map((_, i) => (i === 0 || i === 13 ? 60 : 10)))
    expect(bestSpots(meta, data, 'both', flat, null, 1)).toEqual([13])
  })

  it('leaves out ground that is too steep', () => {
    const data = month(values.map((_, i) => (i === 0 ? 60 : 10)))
    const steep = new Uint8Array(25)
    steep[0] = 100
    expect(bestSpots(meta, data, 'both', steep, 10, 5)).toEqual([])
    expect(bestSpots(meta, data, 'both', steep, null, 5)).toEqual([0])
  })

  it('wants fewer hours without Sun', () => {
    const data = month(values.map((_, i) => (i === 24 ? 90 : 10)))
    expect(cellValue(data, 'sunGap', 24)).toBe(10)
    expect(bestSpots(meta, data, 'sunGap', flat, null, 1)).toEqual([24])
    expect(largestGapH(data)).toBe(90)
  })
})

describe('real nearby maps', () => {
  const dataFile = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)))
  const sites = JSON.parse(dataFile('sites.json').toString()) as SiteInfo[]
  const mapped = sites.filter((site) => site.nearby_half_m)

  it('exist for the four ridge sites', () => {
    expect(mapped.map((site) => site.id)).toEqual([
      'connecting-ridge',
      'shackleton-rim',
      'peak-near-shackleton',
      'de-gerlache-rim',
    ])
  })

  it.each(mapped.map((site) => [site.id, site] as const))('%s lines up with the site and the projection', (id, site) => {
    const real = JSON.parse(dataFile(`nearby/${id}/meta.json`).toString()) as NearbyMeta
    const center = polarXY(site.lat, site.lon)
    expect(Math.abs(real.center_x_m - center.x)).toBeLessThan(1)
    expect(Math.abs(real.center_y_m - center.y)).toBeLessThan(1)

    const corner = cellLatLon(real, 0)
    expect(Math.abs(corner.lat - real.corner.lat)).toBeLessThan(0.0001)
    expect(Math.abs(corner.lon - real.corner.lon)).toBeLessThan(0.01)
    expect(cellAt(real, site.lat, site.lon)).toBe(centerCell(real))

    // The middle cell is the site, so it must read like the site's own month.
    const summary = JSON.parse(dataFile(`${id}/2027-05/summary.json`).toString()) as Summary
    const bytes = gunzipSync(dataFile(`nearby/${id}/2027-05.bin.gz`))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const may = decodeNearbyMonth(buffer, real.size)
    const here = centerCell(real)
    expect(Math.abs(may.sun[here] - summary.pct_sun)).toBeLessThanOrEqual(1)
    expect(Math.abs(may.earth[here] - summary.pct_earth)).toBeLessThanOrEqual(1)
    expect(Math.abs(may.both[here] - summary.pct_both)).toBeLessThanOrEqual(1)
    expect(Math.abs(may.sunGapH[here] - summary.max_sun_gap_h)).toBeLessThanOrEqual(1)
  })
})
