import { enuBasis } from './customModel'

const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180
const LEVEL_DROP_M = [0, 15, 80]

export interface MeshLevel {
  /** Half the width of this level's square around the site, in meters. */
  halfM: number
  stepM: number
}

export interface TerrainLevel extends MeshLevel {
  size: number
  /** Height above the 1737.4 km sphere per grid point, from the north row and west column. */
  heights: Float32Array
  /** East, north and up from the site's ground, per grid point, in meters. */
  positions: Float32Array
  indices: Uint32Array
}

/**
 * One square of terrain, as a grid on the plane touching the Moon at the site. A point's grid position
 * is where the line from the Moon's center through it crosses that plane, so the shader can find any
 * point's height exactly. Triangles wholly inside `holeHalfM` are left out, because a finer level
 * covers them; `dropM` lowers this level so the two don't flicker where they overlap.
 */
export function buildTerrainLevel(
  heightAt: (latDeg: number, lonDeg: number) => number,
  latDeg: number,
  lonDeg: number,
  siteHeightM: number,
  { halfM, stepM }: MeshLevel,
  holeHalfM = 0,
  dropM = 0,
): TerrainLevel {
  const { east, north, up } = enuBasis(latDeg, lonDeg)
  const size = Math.round((2 * halfM) / stepM) + 1
  const siteRadius = MOON_RADIUS_M + siteHeightM
  const heights = new Float32Array(size * size)
  const positions = new Float32Array(size * size * 3)
  for (let row = 0; row < size; row += 1) {
    const n = (halfM - row * stepM) / MOON_RADIUS_M
    for (let col = 0; col < size; col += 1) {
      const e = (col * stepM - halfM) / MOON_RADIUS_M
      const x = up[0] + e * east[0] + n * north[0]
      const y = up[1] + e * east[1] + n * north[1]
      const z = up[2] + e * east[2] + n * north[2]
      const length = Math.hypot(x, y, z)
      const height = heightAt(Math.asin(z / length) / RAD, Math.atan2(y, x) / RAD)
      const i = row * size + col
      heights[i] = height
      // Scale along the line from the center: distance from the site along up, e and n stay exact.
      const radialScale = (MOON_RADIUS_M + height - dropM) / length
      positions[i * 3] = e * radialScale
      positions[i * 3 + 1] = n * radialScale
      positions[i * 3 + 2] = radialScale - siteRadius
    }
  }
  return { halfM, stepM, size, heights, positions, indices: gridIndices(size, stepM, halfM, holeHalfM) }
}

/** Finer terrain near the site and coarser far away, ready to draw. */
export function buildSiteLevels(
  heightAt: (latDeg: number, lonDeg: number) => number,
  latDeg: number,
  lonDeg: number,
  levels: MeshLevel[],
): { levels: TerrainLevel[]; siteHeightM: number; maxHeightM: number } {
  const siteHeightM = heightAt(latDeg, lonDeg)
  const built = levels.map((level, i) =>
    buildTerrainLevel(
      heightAt,
      latDeg,
      lonDeg,
      siteHeightM,
      level,
      i > 0 ? levels[i - 1].halfM - level.stepM : 0,
      LEVEL_DROP_M[i],
    ),
  )
  let maxHeightM = Number.NEGATIVE_INFINITY
  for (const level of built) {
    for (const height of level.heights) if (height > maxHeightM) maxHeightM = height
  }
  return { levels: built, siteHeightM, maxHeightM }
}

function gridIndices(size: number, stepM: number, halfM: number, holeHalfM: number): Uint32Array {
  const indices = new Uint32Array((size - 1) * (size - 1) * 6)
  let used = 0
  const insideHole = (i: number) => Math.abs(i * stepM - halfM) <= holeHalfM
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      if (insideHole(row) && insideHole(row + 1) && insideHole(col) && insideHole(col + 1)) continue
      const a = row * size + col
      const b = a + 1
      const c = a + size
      const d = c + 1
      indices.set([a, c, b, b, c, d], used)
      used += 6
    }
  }
  return indices.slice(0, used)
}
