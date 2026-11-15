import type { Spread } from './landingOdds'

/**
 * Words for the Landing accuracy panel: which way a better aim point lies, how close the lander
 * gets to its aim, and which of the verdict's colours the odds are said in. No number is worked
 * out here: the odds and distances are the panel's own, from `landingOdds`.
 */

const RAD = Math.PI / 180
const EIGHT = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/**
 * The compass bearing from one point on the Moon to another close by, in degrees clockwise from
 * north (0 to 360). For points a few kilometres apart at most, and not at a pole: the step north is
 * the change in latitude, the step east the change in longitude shrunk by the latitude's cosine.
 */
export function bearingBetweenDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const north = to.lat - from.lat
  const turn = ((((to.lon - from.lon) % 360) + 540) % 360) - 180
  const east = turn * Math.cos(from.lat * RAD)
  return ((Math.atan2(east, north) / RAD) % 360 + 360) % 360
}

/** "north-east" for 40°: the nearest of the eight compass points. */
export function compassWords(bearingDeg: number): string {
  return EIGHT[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]
}

/** "within 100 m of its aim point", with the longer reach along the approach when the miss is stretched. */
export function closenessWords(spread: Spread): string {
  const near = `within ${spread.accuracyM.toLocaleString('en-US')} m of its aim point`
  return spread.stretch === 1 ? near : `${near}, ${Math.round(spread.accuracyM * spread.stretch).toLocaleString('en-US')} m along its approach`
}

/** The odds worth keeping: the panel's "good" line, also used for how loose the accuracy can be. */
export const GOOD_ODDS = 0.9

/**
 * Which of the verdict's three colours the odds are said in: "fit" at the good line or better,
 * "miss" when a landing is more likely not to fit than to fit, "marginal" between.
 */
export function oddsTone(fit: number): 'fit' | 'marginal' | 'miss' {
  return fit >= GOOD_ODDS ? 'fit' : fit < 0.5 ? 'miss' : 'marginal'
}

/**
 * What it means when a scenario fits at its aim point while few landings aimed there fit, as one
 * line for Compare that names each such scenario. "Few" is under half, where the odds are said in
 * the verdict's red. Null when no scenario is in that case.
 */
export function fitsButFewLandWords(rows: { letter: string; fits: boolean; odds: number | null }[]): string | null {
  const few = rows.filter((row) => row.fits && row.odds !== null && row.odds < 0.5).map((row) => row.letter)
  if (few.length === 0) return null
  const one = few.length === 1
  const names = one ? few[0] : `${few.slice(0, -1).join(', ')} and ${few.at(-1)}`
  return `${names} ${one ? 'fits' : 'fit'} at ${one ? 'its' : 'their'} aim point, but most landings aimed there come down nearby where the mission does not fit.`
}
