import { describe, expect, it } from 'vitest'
import { FITS, missCode } from './landingOdds'
import type { Requirements } from './mission'
import { hourOfYear, smoothMoonFit, smoothMoonVerdict, WASH_SIZE, washPixel } from './moonWash'

const REQ: Requirements = { missionDays: 14, maxSunGapH: 24, maxEarthGapH: 99_999, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }
const SUN_KM = 149_600_000
const EARTH_KM = 384_400
/** How long the Sun takes to come back to the same place in the Moon's sky, in hours. */
const LUNAR_DAY_H = 708

/**
 * Hourly positions for a made-up sky: Earth fixed over 0° longitude on the equator, and the Sun
 * over the equator at `sunLonDeg(hour)`.
 */
function sky(hours: number, sunLonDeg: (hour: number) => number): Float32Array {
  const positions = new Float32Array(6 * hours)
  for (let hour = 0; hour < hours; hour += 1) {
    const lon = (sunLonDeg(hour) * Math.PI) / 180
    positions.set([SUN_KM * Math.cos(lon), SUN_KM * Math.sin(lon), 0, EARTH_KM, 0, 0], 6 * hour)
  }
  return positions
}

describe('a smooth Moon', () => {
  it('fits where the Sun and Earth are both up, with a Sun that stands still', () => {
    const fit = smoothMoonFit(sky(400, () => 0), 0, REQ)
    if (!fit) throw new Error('no picture')
    const at = (lat: number, lon: number) => fit[washPixel(lat, lon)]
    expect(at(0, 0)).toBe(1)
    expect(at(40, 60)).toBe(1)
    expect(at(-85, 0)).toBe(1)
    // The far side sees neither.
    expect(at(0, 180)).toBe(0)
    expect(at(0, 100)).toBe(0)
    expect(at(0, -100)).toBe(0)
    // About half the Moon fits.
    const share = fit.reduce((sum, value) => sum + value, 0) / fit.length
    expect(share).toBeGreaterThan(0.45)
    expect(share).toBeLessThan(0.55)
  })

  it('judges the Sun and Earth separately', () => {
    // The Sun over 90° E, Earth over 0°: at 120° E the Sun is up and Earth is not.
    const positions = sky(400, () => 90)
    const both = smoothMoonFit(positions, 0, REQ)
    const sunOnly = smoothMoonFit(positions, 0, { ...REQ, earthAtLanding: false })
    const earthOnly = smoothMoonFit(positions, 0, { ...REQ, sunAtLanding: false, maxSunGapH: 99_999 })
    if (!both || !sunOnly || !earthOnly) throw new Error('no picture')
    expect(both[washPixel(0, 120)]).toBe(0)
    expect(sunOnly[washPixel(0, 120)]).toBe(1)
    expect(earthOnly[washPixel(0, 120)]).toBe(0)
    expect(earthOnly[washPixel(0, -60)]).toBe(1)
    expect(both[washPixel(0, 45)]).toBe(1)
  })

  it('needs the Sun to stay up for the mission, as the day goes round', () => {
    // The Sun goes west round the Moon once a lunar day, starting over 0°.
    const positions = sky(LUNAR_DAY_H, (hour) => (-360 * hour) / LUNAR_DAY_H)
    const fit = smoothMoonFit(positions, 0, { ...REQ, earthAtLanding: false })
    if (!fit) throw new Error('no picture')
    // At 80° W the Sun has just risen: it stays up for the fourteen days.
    expect(fit[washPixel(0, -80)]).toBe(1)
    // At 0° it is noon: the Sun sets in a week, and the dark outlasts a day.
    expect(fit[washPixel(0, 0)]).toBe(0)
    // At 80° E it is about to set.
    expect(fit[washPixel(0, 80)]).toBe(0)
    // A lander that can sit out the dark fits wherever the Sun is up at landing.
    const hardy = smoothMoonFit(positions, 0, { ...REQ, earthAtLanding: false, maxSunGapH: 400 })
    expect(hardy?.[washPixel(0, 0)]).toBe(1)
    expect(hardy?.[washPixel(0, 80)]).toBe(1)
    expect(hardy?.[washPixel(0, 170)]).toBe(0)
  })

  it('reads the landing hour it is given, and says when the positions run out', () => {
    const positions = sky(LUNAR_DAY_H + 400, (hour) => (-360 * hour) / LUNAR_DAY_H)
    // A quarter of a lunar day later the Sun is over 90° W: there it is noon now.
    const later = smoothMoonFit(positions, LUNAR_DAY_H / 4, { ...REQ, earthAtLanding: false, missionDays: 1 })
    expect(later?.[washPixel(0, -90)]).toBe(1)
    expect(later?.[washPixel(0, 90)]).toBe(0)
    expect(smoothMoonFit(positions, LUNAR_DAY_H + 100, REQ)).toBeNull()
    expect(smoothMoonFit(positions, -1, REQ)).toBeNull()
  })

  it('counts the Earth clearance a mission asks for', () => {
    // Earth over 0° on the equator: from 87° E it stands about 3° above level, from 80° E about 10°.
    const positions = sky(400, () => 90)
    const any = smoothMoonFit(positions, 0, { ...REQ, sunAtLanding: false, maxSunGapH: 99_999 })
    const clear = smoothMoonFit(positions, 0, { ...REQ, sunAtLanding: false, maxSunGapH: 99_999, minEarthClearanceDeg: 5 })
    if (!any || !clear) throw new Error('no picture')
    expect(any[washPixel(0, 87)]).toBe(1)
    expect(clear[washPixel(0, 87)]).toBe(0)
    expect(clear[washPixel(0, 80)]).toBe(1)
    // A clearance takes ground away and gives none.
    for (let pixel = 0; pixel < any.length; pixel += 1) expect(clear[pixel]).toBeLessThanOrEqual(any[pixel])
  })

  it('says what fails first, in the verdict’s own order, and fits where the fit says so', () => {
    // The Sun goes west round the Moon once a lunar day, starting over 0°; Earth stays over 0°.
    const positions = sky(LUNAR_DAY_H, (hour) => (-360 * hour) / LUNAR_DAY_H)
    const req = { ...REQ, maxEarthGapH: 24 }
    const verdict = smoothMoonVerdict(positions, 0, req)
    const fit = smoothMoonFit(positions, 0, req)
    if (!verdict || !fit) throw new Error('no picture')
    const at = (lat: number, lon: number) => verdict[washPixel(lat, lon)]
    // Just risen, Earth in view: it fits.
    expect(at(0, -80)).toBe(FITS)
    // Noon, Earth overhead: the Sun sets in a week, and the dark outlasts a day.
    expect(at(0, 0)).toBe(missCode('dark'))
    // The far side at night: the Sun is down at landing, which is said before Earth being out of view.
    expect(at(0, 170)).toBe(missCode('sunAtLanding'))
    // A Sun that stands over 90° E: at 120° E it is day and Earth, over 0°, is out of view at landing.
    const still = sky(400, () => 90)
    expect(smoothMoonVerdict(still, 0, req)?.[washPixel(0, 120)]).toBe(missCode('earthAtLanding'))
    // With no need of Earth at landing, the same place has light for the stay and no radio: silence.
    expect(smoothMoonVerdict(still, 0, { ...req, earthAtLanding: false })?.[washPixel(0, 120)]).toBe(missCode('silence'))
    // At 120° W both the dark and the silence are too long: the dark is said.
    expect(smoothMoonVerdict(still, 0, { ...req, earthAtLanding: false, sunAtLanding: false })?.[washPixel(0, -120)]).toBe(missCode('dark'))
    for (let pixel = 0; pixel < fit.length; pixel += 1) expect(fit[pixel] === 1).toBe(verdict[pixel] === FITS)
    expect(verdict).toHaveLength(WASH_SIZE.width * WASH_SIZE.height)
  })

  it('samples a long mission and still finds its long dark', () => {
    const positions = sky(90 * 24, (hour) => (-360 * hour) / LUNAR_DAY_H)
    const long: Requirements = { ...REQ, missionDays: 90, earthAtLanding: false, maxSunGapH: 300 }
    // On the equator the dark lasts half a lunar day, 354 hours: more than 300.
    expect(smoothMoonFit(positions, 0, long)?.[washPixel(0, -80)]).toBe(0)
    expect(smoothMoonFit(positions, 0, { ...long, maxSunGapH: 372 })?.[washPixel(0, -80)]).toBe(1)
  })
})

describe('the picture', () => {
  it('finds a place’s pixel', () => {
    const { width, height } = WASH_SIZE
    expect(washPixel(89.9, -179.9)).toBe(0)
    expect(washPixel(-89.9, 179.9)).toBe(width * height - 1)
    expect(washPixel(0.1, 0.1)).toBe((height / 2 - 1) * width + width / 2)
    expect(washPixel(0, 540)).toBe(washPixel(0, 180))
  })

  it('names the year and the hour within it', () => {
    expect(hourOfYear('2026-01-01T00:00:00Z', 0)).toEqual({ year: 2026, hour: 0 })
    expect(hourOfYear('2026-01-01T00:00:00Z', 8760 + 25)).toEqual({ year: 2027, hour: 25 })
    expect(hourOfYear('2026-01-01T00:00:00Z', 7821)).toEqual({ year: 2026, hour: 7821 })
  })
})
