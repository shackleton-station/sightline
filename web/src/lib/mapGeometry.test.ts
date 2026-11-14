import { describe, expect, it } from 'vitest'
import {
  moonMapLatLon,
  moonMapPosition,
  nightStrips,
  poleMapLatLon,
  poleMapPosition,
  subPoint,
} from './mapGeometry'

describe('moonMapPosition', () => {
  it('centers the near side and wraps longitude', () => {
    expect(moonMapPosition(0, 0)).toEqual({ x: 0.5, y: 0.5 })
    expect(moonMapPosition(90, -180).y).toBe(0)
    expect(moonMapPosition(0, 270).x).toBeCloseTo(moonMapPosition(0, -90).x)
  })

  it('round-trips with clicks', () => {
    const { x, y } = moonMapPosition(26.13, 3.63)
    const { lat, lon } = moonMapLatLon(x, y)
    expect(lat).toBeCloseTo(26.13)
    expect(lon).toBeCloseTo(3.63)
  })
})

describe('poleMapPosition', () => {
  it('puts the pole in the center', () => {
    const p = poleMapPosition(-90, 0, 60_000)
    expect(p?.x).toBeCloseTo(0.5)
    expect(p?.y).toBeCloseTo(0.5)
  })

  it('matches the published position of a site', () => {
    // Connecting Ridge: X = -11287.5 m, Y = -12167.5 m in the DEM's projection.
    const p = poleMapPosition(-89.45267, -137.14865, 60_000)
    expect(p?.x).toBeCloseTo((-11287.5 + 60_000) / 120_000, 3)
    expect(p?.y).toBeCloseTo((60_000 + 12167.5) / 120_000, 3)
  })

  it('returns null for points off the image', () => {
    expect(poleMapPosition(-80, 0, 60_000)).toBeNull()
    expect(poleMapPosition(10, 0, 60_000)).toBeNull()
  })
})

describe('poleMapLatLon', () => {
  it('round-trips with positions', () => {
    const p = poleMapPosition(-89.45267, -137.14865, 60_000)
    const back = poleMapLatLon(p?.x ?? 0, p?.y ?? 0, 60_000)
    expect(back.lat).toBeCloseTo(-89.45267, 5)
    expect(back.lon).toBeCloseTo(-137.14865, 3)
  })
})

describe('subPoint', () => {
  it('finds latitude and longitude from a direction', () => {
    const p = subPoint([0, 1, 0])
    expect(p.lat).toBeCloseTo(0)
    expect(p.lon).toBeCloseTo(90)
    expect(subPoint([0, 0, 1]).lat).toBeCloseTo(90)
  })
})

describe('nightStrips', () => {
  const nightAt = (sub: { lat: number; lon: number }, lat: number, lon: number) => {
    const strips = nightStrips(sub)
    const strip = strips.reduce((best, s) =>
      Math.abs(s.lat - lat) < Math.abs(best.lat - lat) ? s : best,
    )
    return strip.ranges.some(([west, east]) => lon >= west && lon <= east)
  }

  it('lights the point under the Sun and darkens the opposite side', () => {
    const sub = { lat: 1, lon: 40 }
    expect(nightAt(sub, 1, 40)).toBe(false)
    expect(nightAt(sub, -1, -140)).toBe(true)
  })

  it('splits night that crosses the ±180° line', () => {
    const strips = nightStrips({ lat: 0, lon: 0 })
    const equator = strips.reduce((best, s) => (Math.abs(s.lat) < Math.abs(best.lat) ? s : best))
    expect(equator.ranges).toHaveLength(2)
    expect(nightAt({ lat: 0, lon: 0 }, 0, 179)).toBe(true)
    expect(nightAt({ lat: 0, lon: 0 }, 0, -179)).toBe(true)
    expect(nightAt({ lat: 0, lon: 0 }, 0, 89)).toBe(false)
    expect(nightAt({ lat: 0, lon: 0 }, 0, 91)).toBe(true)
  })

  it('keeps one pole lit and the other dark when the Sun is off the equator', () => {
    const sub = { lat: -1.5, lon: 0 }
    expect(nightAt(sub, -89, 180)).toBe(false)
    expect(nightAt(sub, 89, 0)).toBe(true)
  })
})
