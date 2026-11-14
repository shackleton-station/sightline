/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { horizonAt, visibleFraction } from './customModel'
import {
  acrossDeg,
  bodyRadiiDeg,
  boundedLook,
  cameraAxes,
  compassPoint,
  diskClearanceDeg,
  diskOutline,
  dragLook,
  drawnEl,
  elevationMarks,
  framingPitch,
  type Lens,
  pixelsPerDegree,
  project,
  shownDiskShare,
  skyVector,
  trueEl,
  turnBetween,
  unproject,
  fovForAcross,
} from './surfaceView'

const dataPath = (name: string) => fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url))
const json = <T>(name: string) => JSON.parse(readFileSync(dataPath(name), 'utf8')) as T
const positionsOf = (year: number) => {
  const file = readFileSync(dataPath(`custom/ephemeris-${year}.bin`))
  return new Float32Array(file.buffer, file.byteOffset, file.byteLength / 4)
}

const lens = (over: Partial<Lens> = {}): Lens => ({ headingDeg: 226, pitchDeg: -1.5, fovDeg: 12, stretch: 1, aspect: 1.8, ...over })

describe('the field of view for a width', () => {
  it('is the one acrossDeg turns back into that width, whatever the picture\'s shape', () => {
    for (const aspect of [0.5, 0.96, 1.6, 2.4]) {
      const fovDeg = fovForAcross(30, aspect)
      expect(acrossDeg({ headingDeg: 0, pitchDeg: 0, fovDeg, stretch: 1, aspect })).toBeCloseTo(30, 9)
    }
  })
})

describe('where a direction lands on the picture', () => {
  it('puts the direction the visitor faces in the middle', () => {
    for (const stretch of [1, 5]) {
      const at = project(lens({ stretch }), 226, -1.5)
      expect(at.x).toBeCloseTo(0, 9)
      expect(at.y).toBeCloseTo(0, 9)
      expect(at.inFront).toBe(true)
    }
  })

  it('puts the top and bottom edges half the field of view from the middle', () => {
    const level = lens({ pitchDeg: 0 })
    expect(project(level, 226, 6).y).toBeCloseTo(1, 9)
    expect(project(level, 226, -6).y).toBeCloseTo(-1, 9)
    // At eye level, east of the heading is to the right, by the same number of pixels per degree.
    const right = project(level, 226 + 6, 0)
    expect(right.y).toBeCloseTo(0, 9)
    expect(right.x * level.aspect).toBeCloseTo(1, 9)
  })

  it('faces north with east on the right, and says what is behind', () => {
    const north = lens({ headingDeg: 0, pitchDeg: 0 })
    expect(cameraAxes(north).right).toEqual([1, -0, 0])
    expect(project(north, 90, 0).inFront).toBe(false)
    expect(project(north, 180, 0).inFront).toBe(false)
    expect(project(north, 359, 0).x).toBeLessThan(0)
  })

  it('maps a point of the picture back to the direction that lands there', () => {
    for (const view of [lens(), lens({ stretch: 5 }), lens({ headingDeg: 350, pitchDeg: 40, fovDeg: 60 }), lens({ pitchDeg: -20, fovDeg: 3, aspect: 0.5 })]) {
      for (const [x, y] of [[0, 0], [0.9, 0.7], [-1, -1], [0.3, -0.8]]) {
        const { az, el } = unproject(view, x, y)
        const back = project(view, az, el)
        expect(back.x).toBeCloseTo(x, 7)
        expect(back.y).toBeCloseTo(y, 7)
      }
    }
  })

  it('is the same camera Three.js sets up: right, up and forward at right angles', () => {
    const { right, up, forward } = cameraAxes(lens({ headingDeg: 123, pitchDeg: 17, stretch: 5 }))
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(right, up)).toBeCloseTo(0, 12)
    expect(dot(right, forward)).toBeCloseTo(0, 12)
    expect(dot(up, forward)).toBeCloseTo(0, 12)
    expect(dot(up, up)).toBeCloseTo(1, 12)
    // No roll: "right" is always level.
    expect(right[2]).toBe(0)
    expect(skyVector(90, 0)[0]).toBeCloseTo(1, 12)
    expect(skyVector(0, 90)[2]).toBeCloseTo(1, 12)
  })
})

describe('stretching heights', () => {
  it('multiplies every height above or below eye level, and undoes exactly', () => {
    const tan = (deg: number) => Math.tan((deg * Math.PI) / 180)
    for (const el of [-30, -2.76, -0.09, 0, 0.5, 6, 45, 89]) {
      expect(tan(drawnEl(el, 5))).toBeCloseTo(5 * tan(el), 6)
      expect(trueEl(drawnEl(el, 5), 5)).toBeCloseTo(el, 9)
      expect(drawnEl(el, 1)).toBe(el)
    }
    expect(drawnEl(0, 5)).toBe(0)
    expect(drawnEl(90, 5)).toBeCloseTo(90, 9)
  })

  it('moves a hill five times as far from eye level on the picture, and nothing sideways', () => {
    const plain = lens({ pitchDeg: 0 })
    const stretched = lens({ pitchDeg: 0, stretch: 5 })
    expect(project(stretched, 226, 1).y / project(plain, 226, 1).y).toBeCloseTo(5, 2)
    expect(project(stretched, 230, 0).x).toBeCloseTo(project(plain, 230, 0).x, 9)
    // A disk becomes an oval five times as tall as wide.
    const oval = diskOutline(stretched, 226, 0, 0.265)
    expect((oval.ry / (oval.rx * stretched.aspect))).toBeCloseTo(5, 1)
    const round = diskOutline(plain, 226, 0, 0.265)
    expect(round.ry / (round.rx * plain.aspect)).toBeCloseTo(1, 3)
  })

  it('spreads the scale of elevations by the stretch', () => {
    const marks = elevationMarks(lens({ pitchDeg: 0, fovDeg: 12 }), -0.98, 780, 52)
    expect(marks.map((mark) => mark.el)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5])
    const stretched = elevationMarks(lens({ pitchDeg: 0, fovDeg: 12, stretch: 5 }), -0.98, 780, 52)
    expect(stretched.map((mark) => mark.el)).toEqual([-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1])
  })
})

describe('looking around', () => {
  it('follows the pointer: a drag of one degree of pixels turns one degree', () => {
    const perDegree = pixelsPerDegree(12, 780)
    const turned = dragLook(lens({ pitchDeg: 0 }), perDegree, 0, 780)
    expect(turned.headingDeg).toBeCloseTo(225, 9)
    const tipped = dragLook(lens({ pitchDeg: 0 }), 0, perDegree, 780)
    expect(tipped.pitchDeg).toBeCloseTo(1, 9)
    // Stretched, the same drag moves a fifth as much true elevation: the scene still follows the pointer.
    expect(dragLook(lens({ pitchDeg: 0, stretch: 5 }), 0, perDegree, 780).pitchDeg).toBeCloseTo(0.2, 2)
  })

  it('keeps a look inside what can be drawn', () => {
    const look = boundedLook({ headingDeg: -10, pitchDeg: 200, fovDeg: 500, stretch: 0 })
    expect(look.headingDeg).toBe(350)
    expect(look.pitchDeg).toBe(85)
    expect(look.fovDeg).toBe(80)
    expect(look.stretch).toBe(1)
  })

  it('turns the short way, names compass points and measures the view across', () => {
    expect(turnBetween(350, 10)).toBe(20)
    expect(turnBetween(10, 350)).toBe(-20)
    expect(compassPoint(226)).toBe('SW')
    expect(compassPoint(359)).toBe('N')
    expect(acrossDeg(lens({ fovDeg: 90, aspect: 1 }))).toBeCloseTo(90, 9)
  })

  it('frames a low body with the skyline under it, and a high one on its own', () => {
    const look = { headingDeg: 0, pitchDeg: 0, fovDeg: 12, stretch: 1 }
    expect(framingPitch(-1.16, -1.3, look)).toBeCloseTo(-1.23, 9)
    // Earth 7.9° over the land: it sits a quarter of the picture above the middle, with the land still in view.
    expect(framingPitch(5.9, -2, look)).toBeCloseTo(2.9, 9)
    expect(framingPitch(60, 1, look)).toBeCloseTo(57, 9)
  })
})

describe('the size of the disks', () => {
  it('works the radius out from the distance, as the pipeline does', () => {
    // One astronomical unit away along x, and a mean lunar distance away along y.
    const positions = [149_597_870.7, 0, 0, 0, 384_400, 0]
    const { sun, earth } = bodyRadiiDeg(positions, 0, -90, 0)
    expect(sun).toBeCloseTo(0.26645, 4)
    expect(earth).toBeCloseTo(0.9496, 3)
  })
})

// ---- Against the pipeline's own data ----

const SITES = json<SiteInfo[]>('sites.json')
const RIDGES = ['connecting-ridge', 'shackleton-rim', 'de-gerlache-rim']
const MONTH = '2027-05'
/** The track and the horizon file are rounded to 0.01°, so a rim this close to the skyline can read either way. */
const ROUNDING_DEG = 0.01

interface Tally {
  hours: number
  worstShare: number
  sumShare: number
  worstFlat: number
  sunDiffer: string[]
  earthDiffer: string[]
}

/** Every hour of a site's month: what the view shows of each disk, against the track. */
function compare(siteId: string, month: string): Tally {
  const site = SITES.find((candidate) => candidate.id === siteId) as SiteInfo
  const horizon = json<HorizonPoint[]>(`${siteId}/horizon.json`)
  const track = json<TrackPoint[]>(`${siteId}/${month}/track.json`)
  const year = Number(month.slice(0, 4))
  const positions = positionsOf(year)
  const tally: Tally = { hours: track.length, worstShare: 0, sumShare: 0, worstFlat: 0, sunDiffer: [], earthDiffer: [] }
  for (const point of track) {
    const hour = (Date.parse(point.t) - Date.UTC(year, 0, 1)) / 3_600_000
    const radii = bodyRadiiDeg(positions, hour, site.lat, site.lon)
    const share = shownDiskShare(horizon, point.sun_az, point.sun_el, radii.sun)
    tally.worstShare = Math.max(tally.worstShare, Math.abs(share - point.sun_frac))
    tally.sumShare += Math.abs(share - point.sun_frac)
    // The pipeline's own rule with these radii, as a check on the radii.
    const flat = visibleFraction(point.sun_el - horizonAt(horizon, point.sun_az), radii.sun)
    tally.worstFlat = Math.max(tally.worstFlat, Math.abs(flat - point.sun_frac))

    const sunRim = diskClearanceDeg(horizon, point.sun_az, point.sun_el, radii.sun)
    const earthRim = diskClearanceDeg(horizon, point.earth_az, point.earth_el, radii.earth)
    // The rim never stands lower over the skyline's true shape than over a level line under the disk's middle.
    expect(sunRim).toBeGreaterThanOrEqual(point.sun_el + radii.sun - horizonAt(horizon, point.sun_az) - 1e-9)
    if (sunRim > 0 !== point.sun_up) tally.sunDiffer.push(explain(point.t, point.sun_up, sunRim))
    if (earthRim > 0 !== point.earth_up) tally.earthDiffer.push(explain(point.t, point.earth_up, earthRim))
  }
  return tally
}

/** Why an hour differs. Anything else fails the test. */
function explain(t: string, up: boolean, rimDeg: number): string {
  if (Math.abs(rimDeg) <= ROUNDING_DEG) return `${t}: within rounding (${rimDeg.toFixed(4)}°)`
  // The track says hidden, and the skyline dips beside the disk's middle far enough to show a sliver.
  if (!up && rimDeg > 0) return `${t}: a sliver beside the middle (${rimDeg.toFixed(4)}°)`
  throw new Error(`${t}: the track says ${up ? 'up' : 'hidden'} but the rim is ${rimDeg.toFixed(4)}° from the skyline`)
}

describe('the view against the track', () => {
  it.each(RIDGES)('shows the share of the Sun the track gives, every hour of a month at %s', (siteId) => {
    const tally = compare(siteId, MONTH)
    expect(tally.hours).toBe(744)
    // The track's figure treats the skyline under the disk as level; the view follows its shape.
    expect(tally.worstShare).toBeLessThan(0.06)
    expect(tally.sumShare / tally.hours).toBeLessThan(0.002)
    // With the distances' radii, the pipeline's own rule gives the track's figure to within its rounding.
    expect(tally.worstFlat).toBeLessThan(0.025)
  })

  it('agrees on "any part showing" in every hour but three, each within the rounding of the data', () => {
    const tallies = RIDGES.map((siteId) => compare(siteId, MONTH))
    const sun = tallies.flatMap((tally) => tally.sunDiffer)
    const earth = tallies.flatMap((tally) => tally.earthDiffer)
    expect(sun).toHaveLength(3)
    expect(sun.every((line) => line.includes('within rounding'))).toBe(true)
    expect(earth).toHaveLength(0)
  })

  it('never differs from the track by more than a sliver, at every listed site for the month', () => {
    for (const site of SITES) {
      const tally = compare(site.id, MONTH)
      expect(tally.worstShare).toBeLessThan(0.06)
      // compare() throws on any hour it cannot explain.
      expect(tally.sunDiffer.length + tally.earthDiffer.length).toBeLessThan(4)
    }
  })

  // The whole data set, for docs/VALIDATION.md: SURFACE_FULL=1 npx vitest run src/lib/surfaceView.test.ts
  it.runIf(process.env.SURFACE_FULL)('reports the agreement over every site and month', { timeout: 600_000 }, () => {
    let hours = 0
    let worst = 0
    let sum = 0
    const differ = { sunRounding: 0, sunSliver: 0, earthRounding: 0, earthSliver: 0 }
    for (const site of SITES) {
      const months = readdirSync(dataPath(site.id)).filter((name) => /^\d{4}-\d{2}$/.test(name))
      for (const month of months) {
        const tally = compare(site.id, month)
        hours += tally.hours
        worst = Math.max(worst, tally.worstShare)
        sum += tally.sumShare
        for (const line of tally.sunDiffer) differ[line.includes('rounding') ? 'sunRounding' : 'sunSliver'] += 1
        for (const line of tally.earthDiffer) differ[line.includes('rounding') ? 'earthRounding' : 'earthSliver'] += 1
      }
    }
    console.log(`${SITES.length} sites, ${hours} hours: share of the Sun's disk differs by ${(sum / hours).toFixed(5)} on average, ${worst.toFixed(4)} at worst`)
    console.log(`"any part showing" differs in ${differ.sunRounding + differ.sunSliver} hours for the Sun (${differ.sunRounding} within rounding, ${differ.sunSliver} a sliver beside the middle)`)
    console.log(`and ${differ.earthRounding + differ.earthSliver} hours for Earth (${differ.earthRounding} within rounding, ${differ.earthSliver} a sliver beside the middle)`)
    expect(worst).toBeLessThan(0.06)
  })
})
