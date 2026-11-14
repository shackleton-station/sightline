import type { Vec3 } from './camera3d'
import { enuBasis } from './customModel'

/**
 * A Moon-fixed direction as east, north and up at a site, which is what the 3D view draws in.
 * North points toward the Moon's north pole, as in the panorama.
 */
export function toLocalDirection(direction: readonly number[], latDeg: number, lonDeg: number): Vec3 {
  const { east, north, up } = enuBasis(latDeg, lonDeg)
  const along = (axis: Vec3) => axis[0] * direction[0] + axis[1] * direction[1] + axis[2] * direction[2]
  return [along(east), along(north), along(up)]
}
