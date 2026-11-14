import type { Requirements } from './mission'

/**
 * Where a landing fits the mission's Sun and Earth limits, across the whole Moon, on a smooth Moon:
 * a sphere with no terrain. It is the same test the light grid answers near the south pole
 * (`missionGrid.ts`), from the same hourly positions of the Sun and Earth, but with a level horizon
 * everywhere. So it knows day from night and the near side from the far side, and nothing of a
 * ridge's shadow or a crater's wall. The slope is not judged. It is for coloring the Moon away from
 * the pole, where the light grid does not reach; it is not a site's verdict.
 *
 * The picture is laid out like a map of the world: longitude across from 180° W to 180° E, latitude
 * down from the north pole.
 */

const RAD = Math.PI / 180
const MOON_RADIUS_KM = 1737.4
const EARTH_RADIUS_KM = 6371
/** The Sun's radius as seen from the Moon, and how far below level the horizon is from 2 m up, in degrees. */
const SUN_RADIUS_DEG = 0.2666
const DIP_DEG = 0.087

export interface WashSize {
  width: number
  height: number
}

/** A size that keeps the whole-Moon picture quick to work out: about 0.7° (21 km at the equator) a pixel. */
export const WASH_SIZE: WashSize = { width: 512, height: 256 }

/** At most this many moments of the mission are looked at; a long mission is sampled every few hours. */
const MAX_SAMPLES = 200

/**
 * For each pixel, 1 where a landing at hour `from` fits the mission's Sun and Earth limits on a
 * smooth Moon and 0 where it does not. `positions` holds the Sun's then Earth's position from the
 * Moon's center in MOON_ME (km), six numbers an hour; null if they stop before the mission ends.
 */
export function smoothMoonFit(positions: ArrayLike<number>, from: number, req: Requirements, size: WashSize = WASH_SIZE): Float32Array | null {
  const missionH = req.missionDays * 24
  if (from < 0 || (from + missionH) * 6 > positions.length) return null
  const step = Math.max(1, Math.ceil(missionH / MAX_SAMPLES))
  const samples = Math.ceil(missionH / step)
  // Each moment's direction to the Sun (it is far enough that every place sees it the same way),
  // Earth's position, and how far Earth's center may be below level with its limb still showing.
  const sun = new Float64Array(3 * samples)
  const earth = new Float64Array(3 * samples)
  const earthLow = new Float64Array(samples)
  for (let k = 0; k < samples; k += 1) {
    const at = (from + k * step) * 6
    const far = Math.hypot(positions[at], positions[at + 1], positions[at + 2])
    for (let i = 0; i < 3; i += 1) {
      sun[3 * k + i] = positions[at + i] / far
      earth[3 * k + i] = positions[at + 3 + i]
    }
    const earthFar = Math.hypot(earth[3 * k], earth[3 * k + 1], earth[3 * k + 2])
    earthLow[k] = -Math.sin(Math.asin(EARTH_RADIUS_KM / earthFar) + DIP_DEG * RAD)
  }
  const sunLow = -Math.sin((SUN_RADIUS_DEG + DIP_DEG) * RAD)

  const fit = new Float32Array(size.width * size.height)
  for (let row = 0; row < size.height; row += 1) {
    const lat = (90 - ((row + 0.5) * 180) / size.height) * RAD
    for (let col = 0; col < size.width; col += 1) {
      const lon = (-180 + ((col + 0.5) * 360) / size.width) * RAD
      const x = Math.cos(lat) * Math.cos(lon)
      const y = Math.cos(lat) * Math.sin(lon)
      const z = Math.sin(lat)
      let sunGap = 0
      let earthGap = 0
      let sunRun = 0
      let earthRun = 0
      let ok = true
      for (let k = 0; k < samples && ok; k += 1) {
        const sunUp = x * sun[3 * k] + y * sun[3 * k + 1] + z * sun[3 * k + 2] > sunLow
        // Earth is near enough that where one stands matters: its direction is taken from the place itself.
        const ex = earth[3 * k] - MOON_RADIUS_KM * x
        const ey = earth[3 * k + 1] - MOON_RADIUS_KM * y
        const ez = earth[3 * k + 2] - MOON_RADIUS_KM * z
        const earthUp = (x * ex + y * ey + z * ez) / Math.hypot(ex, ey, ez) > earthLow[k]
        if (k === 0 && ((req.sunAtLanding && !sunUp) || (req.earthAtLanding && !earthUp))) ok = false
        sunRun = sunUp ? 0 : sunRun + step
        earthRun = earthUp ? 0 : earthRun + step
        if (sunRun > sunGap) sunGap = sunRun
        if (earthRun > earthGap) earthGap = earthRun
        // Once a limit is broken the rest of the mission cannot mend it.
        if (sunGap > req.maxSunGapH || earthGap > req.maxEarthGapH) ok = false
      }
      if (ok) fit[row * size.width + col] = 1
    }
  }
  return fit
}

/**
 * The picture a little softened, so its edges are not steps: each pixel half itself and a quarter
 * each of its neighbours, across and then down. Across, the picture wraps round the Moon.
 */
export function softened(field: Float32Array, size: WashSize): Float32Array {
  const { width, height } = size
  const across = new Float32Array(field.length)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const left = field[row * width + ((col + width - 1) % width)]
      const right = field[row * width + ((col + 1) % width)]
      across[row * width + col] = 0.25 * left + 0.5 * field[row * width + col] + 0.25 * right
    }
  }
  const down = new Float32Array(field.length)
  for (let row = 0; row < height; row += 1) {
    const above = Math.max(0, row - 1)
    const below = Math.min(height - 1, row + 1)
    for (let col = 0; col < width; col += 1) down[row * width + col] = 0.25 * across[above * width + col] + 0.5 * across[row * width + col] + 0.25 * across[below * width + col]
  }
  return down
}

/** The pixel holding a place, as its index in the picture. */
export function washPixel(latDeg: number, lonDeg: number, size: WashSize = WASH_SIZE): number {
  const row = Math.min(size.height - 1, Math.max(0, Math.floor(((90 - latDeg) / 180) * size.height)))
  const col = Math.min(size.width - 1, Math.max(0, Math.floor((((((lonDeg + 180) % 360) + 360) % 360) / 360) * size.width)))
  return row * size.width + col
}

/** The year and the hour within it of a moment `hours` after `startIso`, for the yearly ephemeris files. */
export function hourOfYear(startIso: string, hours: number): { year: number; hour: number } {
  const at = Date.parse(startIso) + hours * 3_600_000
  const year = new Date(at).getUTCFullYear()
  return { year, hour: Math.round((at - Date.UTC(year, 0, 1)) / 3_600_000) }
}
