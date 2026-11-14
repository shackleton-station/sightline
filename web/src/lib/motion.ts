/**
 * Reading a phone's motion sensor as "which way is the back of the phone pointing", for looking
 * around the Surface tab by turning. Plain functions; the browser side is surface/useMotionLook.ts.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The three angles a `deviceorientation` event carries (degrees), as the W3C specification names them. */
export interface DeviceAngles {
  alpha: number
  beta: number
  gamma: number
}

export interface Pointing {
  /** Which way the back of the phone points, from the sensor's own zero, clockwise seen from above. */
  headingDeg: number
  /** How far above level it points: 0 held upright, -90 lying flat on a table. */
  pitchDeg: number
}

/**
 * The direction the back of the phone points. The sensor reports the phone's attitude as a turn
 * about its z axis (alpha), then x (beta), then y (gamma); the back of the phone is its -z axis.
 * That axis doesn't change when the screen rotates between upright and sideways, so neither does this.
 */
export function pointingOf({ alpha, beta, gamma }: DeviceAngles): Pointing {
  const a = alpha * RAD
  const b = beta * RAD
  const g = gamma * RAD
  const east = -Math.sin(g) * Math.cos(a) - Math.cos(g) * Math.sin(b) * Math.sin(a)
  const north = -Math.sin(g) * Math.sin(a) + Math.cos(g) * Math.sin(b) * Math.cos(a)
  const up = -Math.cos(g) * Math.cos(b)
  return {
    // Alpha grows counter-clockwise seen from above; a compass heading grows clockwise.
    headingDeg: (((Math.atan2(east, north) * DEG) % 360) + 360) % 360,
    pitchDeg: Math.asin(Math.max(-1, Math.min(1, up))) * DEG,
  }
}

/** True when an event carries all three angles. Laptops and simulators send events full of nulls. */
export function hasAngles(event: { alpha: number | null; beta: number | null; gamma: number | null }): event is DeviceAngles {
  return [event.alpha, event.beta, event.gamma].every((angle) => typeof angle === 'number' && Number.isFinite(angle))
}

/**
 * One step of smoothing toward a new sensor reading, so the picture doesn't shake with the hand.
 * Headings take the short way round past 0°/360°.
 */
export function easeToward(from: Pointing, to: Pointing, share: number): Pointing {
  const turn = ((((to.headingDeg - from.headingDeg + 180) % 360) + 360) % 360) - 180
  return {
    headingDeg: (((from.headingDeg + turn * share) % 360) + 360) % 360,
    pitchDeg: from.pitchDeg + (to.pitchDeg - from.pitchDeg) * share,
  }
}
