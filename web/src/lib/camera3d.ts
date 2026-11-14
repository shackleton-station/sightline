/** Column-major 4×4 matrices and a simple camera, in the site's east, north, up coordinates. */

export type Vec3 = [number, number, number]
export type Mat4 = Float32Array

const RAD = Math.PI / 180

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2])
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** A unit vector from azimuth (clockwise from north) and elevation, in degrees. */
export function fromAzEl(azDeg: number, elDeg: number): Vec3 {
  const flat = Math.cos(elDeg * RAD)
  return [flat * Math.sin(azDeg * RAD), flat * Math.cos(azDeg * RAD), Math.sin(elDeg * RAD)]
}

export function lookFrom(eye: Vec3, forward: Vec3): Mat4 {
  const f = unit(forward)
  const worldUp: Vec3 = Math.abs(f[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1]
  const s = unit(cross(f, worldUp))
  const u = cross(s, f)
  return Float32Array.of(
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  )
}

export function perspective(fovYDeg: number, aspect: number, nearM: number, farM: number): Mat4 {
  const f = 1 / Math.tan((fovYDeg * RAD) / 2)
  return Float32Array.of(
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (farM + nearM) / (nearM - farM), -1,
    0, 0, (2 * farM * nearM) / (nearM - farM), 0,
  )
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** A point's position in CSS pixels, or null if it's behind the camera. */
export function toScreen(
  viewProjection: Mat4,
  point: Vec3,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } | null {
  const m = viewProjection
  const [x, y, z] = point
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  if (w <= 0) return null
  return {
    x: (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * widthPx,
    y: ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * heightPx,
  }
}

export interface CameraPose {
  eye: Vec3
  forward: Vec3
}

/** Looking at the site from a distance, in the direction of `headingDeg`, down by `pitchDeg`. */
export function orbitPose(headingDeg: number, pitchDeg: number, rangeM: number): CameraPose {
  const forward = fromAzEl(headingDeg, -pitchDeg)
  return { eye: [-forward[0] * rangeM, -forward[1] * rangeM, -forward[2] * rangeM], forward }
}

/** Standing at the site with eyes this high, looking along an azimuth and elevation. */
export function standPose(azDeg: number, elDeg: number, eyeHeightM: number): CameraPose {
  return { eye: [0, 0, eyeHeightM], forward: fromAzEl(azDeg, elDeg) }
}
