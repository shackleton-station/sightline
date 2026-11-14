import type { TrackPoint } from '../data/contract'

/** Mean sunlight at 1 AU (W/m²): Kopp & Lean 2011, doi:10.1029/2010GL045777. */
export const SOLAR_CONSTANT_W_M2 = 1361

export interface PanelSunlight {
  /** A vertical panel that turns to face the Sun, as polar landers often use (W/m²). */
  vertical: number
  /** A panel lying flat on the ground (W/m²). */
  flat: number
}

/**
 * Average sunlight reaching a panel over the given hours, before any panel losses. Counts how much
 * of the Sun's disk is visible and how squarely the light hits the panel. It ignores panel
 * efficiency, dust and the few percent that Sun distance changes through the year.
 */
export function panelSunlight(track: TrackPoint[]): PanelSunlight {
  if (track.length === 0) return { vertical: 0, flat: 0 }
  let vertical = 0
  let flat = 0
  for (const point of track) {
    const el = (point.sun_el * Math.PI) / 180
    vertical += point.sun_frac * Math.max(Math.cos(el), 0)
    flat += point.sun_frac * Math.max(Math.sin(el), 0)
  }
  return {
    vertical: (SOLAR_CONSTANT_W_M2 * vertical) / track.length,
    flat: (SOLAR_CONSTANT_W_M2 * flat) / track.length,
  }
}

/**
 * Month and hour within it for a date typed as "YYYY-MM-DDTHH:MM", read as UTC. Null if it's
 * unusable or outside the years given.
 */
export function locateDate(
  value: string,
  years: number[],
): { month: string; index: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(value)
  if (!match) return null
  const [y, d, h] = [match[1], match[3], match[4]].map(Number)
  if (!years.includes(y)) return null
  return { month: value.slice(0, 7), index: (d - 1) * 24 + h }
}

/** A panel and a night-time load, as a user describes them. Assumptions, not results. */
export interface PowerInputs {
  panelAreaM2: number
  /** Fraction of sunlight the panel turns into electricity, 0–1. */
  efficiency: number
  /** What the lander must keep running with no Sun, e.g. heaters and radio (W). */
  nightLoadW: number
}

export interface PowerBudget {
  /** Average electrical power from a vertical, Sun-facing panel over the period (W). */
  averagePanelW: number
  /** Energy to ride out the period's longest time without Sun at the night load (Wh). */
  batteryWh: number
}

/**
 * A first-order power budget from the pipeline's sunlight and longest Sun gap, with the user's own
 * panel and load. Leaves out dust, temperature, battery depth of discharge and wiring losses.
 */
export function powerBudget(
  verticalSunlightWm2: number,
  longestSunGapH: number,
  inputs: PowerInputs,
): PowerBudget {
  const area = Math.max(inputs.panelAreaM2, 0)
  const efficiency = Math.min(Math.max(inputs.efficiency, 0), 1)
  return {
    averagePanelW: verticalSunlightWm2 * area * efficiency,
    batteryWh: Math.max(inputs.nightLoadW, 0) * Math.max(longestSunGapH, 0),
  }
}
