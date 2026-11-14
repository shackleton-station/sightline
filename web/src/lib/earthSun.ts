import type { EarthSunMonth, TrackPoint } from '../data/contract'

/**
 * The Sun on Earth, for comparing with the Moon. Matches pipeline/src/clps/earth_sun.py, and is
 * checked against JPL Horizons there. It ignores the atmosphere: refraction lifts the Sun about 0.5°
 * near the horizon, so real sunsets on Earth come a few minutes later.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The Sun's angular radius from Earth (degrees), for counting it as up while part of it shows. */
const EARTH_SUN_RADIUS_DEG = 0.27

/** A mid-latitude place, the kind most people know: about the latitude of Madrid or Denver. */
export const EVERYDAY_LAT_DEG = 40

/** Sun's elevation (degrees) at a place on Earth, given the point where it's overhead. */
export function earthSunElevation(latDeg: number, lonDeg: number, subLatDeg: number, subLonDeg: number): number {
  const sine =
    Math.sin(latDeg * RAD) * Math.sin(subLatDeg * RAD) +
    Math.cos(latDeg * RAD) * Math.cos(subLatDeg * RAD) * Math.cos((lonDeg - subLonDeg) * RAD)
  return Math.asin(Math.max(-1, Math.min(1, sine))) * DEG
}

export interface SunPath {
  /** Sun's elevation each hour (degrees). */
  el: number[]
  /** Whether any part of the Sun is visible each hour. */
  up: boolean[]
}

/** A month of the Sun's height at a latitude on Earth. Longitude only shifts the clock. */
export function earthPath(month: EarthSunMonth, latDeg: number): SunPath {
  const el = month.sub_lat.map((subLat, i) => earthSunElevation(latDeg, 0, subLat, month.sub_lon[i]))
  return { el, up: el.map((value) => value > -EARTH_SUN_RADIUS_DEG) }
}

/** The same for a lunar site, which also counts terrain blocking the Sun. */
export function moonPath(track: TrackPoint[]): SunPath {
  return { el: track.map((point) => point.sun_el), up: track.map((point) => point.sun_up) }
}

export interface PathStats {
  highestDeg: number
  lowestDeg: number
  /** Longest unbroken stretch with the Sun up, and without it, within this month (hours). */
  longestUpH: number
  longestDownH: number
  /** Times the Sun comes up in this month, not counting one already up as the month begins. */
  rises: number
}

/** The numbers that show how different a place's days are. */
export function pathStats({ el, up }: SunPath): PathStats {
  let longestUpH = 0
  let longestDownH = 0
  let run = 0
  let rises = 0
  for (let i = 0; i < up.length; i += 1) {
    if (i > 0 && up[i] !== up[i - 1]) {
      run = 0
      if (up[i]) rises += 1
    }
    run += 1
    if (up[i]) longestUpH = Math.max(longestUpH, run)
    else longestDownH = Math.max(longestDownH, run)
  }
  return { highestDeg: Math.max(...el), lowestDeg: Math.min(...el), longestUpH, longestDownH, rises }
}

/** "2 h" under two days, otherwise whole days: enough for comparing days with months. */
export function looseDuration(hours: number): string {
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} days`
}
