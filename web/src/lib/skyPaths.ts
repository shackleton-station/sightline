import type { TrackPoint } from '../data/contract'
import { skyVector, type Vec3 } from './surfaceView'

/** One hour of a body's path: its direction as a unit vector, and whether the track has it up. */
export interface PathPoint {
  vector: Vec3
  up: boolean
}

/** The Sun's and Earth's paths over the whole month, hour by hour. */
export interface MonthPaths {
  sun: PathPoint[]
  earth: PathPoint[]
}

/** The month's paths from the track, worked out once per month: drawing them is then cheap every frame. */
export function monthPaths(track: TrackPoint[]): MonthPaths {
  return {
    sun: track.map((point) => ({ vector: skyVector(point.sun_az, point.sun_el), up: point.sun_up })),
    earth: track.map((point) => ({ vector: skyVector(point.earth_az, point.earth_el), up: point.earth_up })),
  }
}
