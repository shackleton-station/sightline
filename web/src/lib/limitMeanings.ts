import { EARTH_RADIUS_KM } from './customModel'
import { BASE_HEIGHT_M } from './heights'
import { EARTH_CLEARANCES_DEG } from './mission'

/**
 * What each of the mission's limits means and why a mission would care, and what counts as "in
 * view": the sentences the mission's controls and the Guide both show, written once here so the
 * two cannot drift. Each figure in them is read from the constant the model itself uses.
 */

/** A limit, as its control names it, with what it is and why it matters. */
export interface LimitMeaning {
  id: 'missionDays' | 'maxSunGapH' | 'sunAtLanding' | 'earthAtLanding' | 'maxEarthGapH' | 'maxSlopeDeg' | 'minEarthClearanceDeg' | 'panelM' | 'antennaM'
  /** The control's own label. */
  name: string
  /** What it is, in two sentences at most: also the control's hover text. */
  means: string
  /** What the written line adds after that: the reason, where it takes more room than a hover text has. */
  more?: string
}

/** The Moon's mean distance from Earth, in km (NASA's Moon fact sheet; REFERENCES.md). */
export const MEAN_EARTH_DISTANCE_KM = 384_400

/** How wide Earth's disc is in the Moon's sky at that distance, in degrees. */
export function earthWidthDeg(): number {
  return (2 * Math.asin(EARTH_RADIUS_KM / MEAN_EARTH_DISTANCE_KM) * 180) / Math.PI
}

/** "2° or 5°": the clearances the data has hourly flags for. */
function clearancesWords(): string {
  return EARTH_CLEARANCES_DEG.map((degrees) => `${degrees}°`).join(' or ')
}

/** What the way to each list is called: the links in the column, and the Guide's heading. */
export const MEANING_LABELS = { limits: 'What each limit means', advanced: 'What these mean' }

/** The controls' own labels, so a label and the line that explains it are one name. */
export const LIMIT_NAMES: Record<LimitMeaning['id'], string> = {
  missionDays: 'Mission length',
  maxSunGapH: 'Longest dark spell',
  sunAtLanding: 'The Sun is in view at landing',
  earthAtLanding: 'Earth is in view at landing',
  maxEarthGapH: 'Radio silence',
  maxSlopeDeg: 'Steepest ground',
  minEarthClearanceDeg: 'Earth must clear the skyline by',
  panelM: 'Solar panel height',
  antennaM: 'Antenna height',
}

/** Where the slope under a site was measured: the stretch of the terrain map, and the site's name. */
export interface SlopeFrom {
  overM: number
  siteName: string
}

/** What the ground's slope is measured over, as the site's data has it; without a site, only where it is from. */
function slopeMore(from: SlopeFrom | null): string {
  const over = from ? `measured across ${from.overM} m of NASA's terrain map at ${from.siteName}` : "read from NASA's terrain map"
  return `The slope is ${over}, so rocks do not show.`
}

/** The six basic limits, in the order the controls show them. */
export function limitMeanings(slope: SlopeFrom | null): LimitMeaning[] {
  return [
    { id: 'missionDays', name: LIMIT_NAMES.missionDays, means: 'How long the lander works on the surface, counted from the landing hour.' },
    { id: 'maxSunGapH', name: LIMIT_NAMES.maxSunGapH, means: 'The longest unbroken time with no part of the Sun in view that the lander can get through on its batteries, staying warm.' },
    { id: 'sunAtLanding', name: LIMIT_NAMES.sunAtLanding, means: 'Tick it if the lander must touch down in sunlight, with power from its first hour.' },
    { id: 'earthAtLanding', name: LIMIT_NAMES.earthAtLanding, means: 'Tick it if touchdown needs a direct radio link, so Earth hears the landing as it happens.' },
    { id: 'maxEarthGapH', name: LIMIT_NAMES.maxEarthGapH, means: 'The longest unbroken time with Earth out of view, and so with no direct radio link, that the mission accepts.' },
    { id: 'maxSlopeDeg', name: LIMIT_NAMES.maxSlopeDeg, means: 'The steepest slope the lander can set down on.', more: slopeMore(slope) },
  ]
}

/** The Advanced controls, in the order they are shown. */
export function advancedMeanings(): LimitMeaning[] {
  return [
    {
      id: 'minEarthClearanceDeg',
      name: LIMIT_NAMES.minEarthClearanceDeg,
      means: "How far Earth's center must stand above the skyline for Earth to count as in view. 0° counts any part of its disc showing.",
      more: `Earth's disc is about ${earthWidthDeg().toFixed(1)}° wide from the Moon. With only its edge over the skyline, ground stations on the hidden part are out of sight, and a signal that grazes the terrain is a poor one. So a mission can ask for ${clearancesWords()}.`,
    },
    {
      id: 'panelM',
      name: LIMIT_NAMES.panelM,
      means: 'The Sun is looked for from this height. From higher up the terrain sits lower in the sky, so the Sun is never in view less.',
    },
    {
      id: 'antennaM',
      name: LIMIT_NAMES.antennaM,
      means: 'Earth is looked for from this height. From higher up the terrain sits lower in the sky, so Earth is never in view less.',
    },
  ]
}

/** A limit's written line: what it is, then the reason where there is more to say. */
export function meaningLine(meaning: LimitMeaning): string {
  return meaning.more ? `${meaning.means} ${meaning.more}` : meaning.means
}

/** One limit's meaning, for its control's hover text. */
export function meaningOf(id: LimitMeaning['id']): string {
  const found = [...limitMeanings(null), ...advancedMeanings()].find((meaning) => meaning.id === id)
  if (!found) throw new Error(`no meaning written for ${id}`)
  return found.means
}

/** The definition the whole verdict rests on, in one sentence. */
export const IN_VIEW = `The Sun or Earth counts as in view when any part of its disc is above the skyline in its direction, seen from ${BASE_HEIGHT_M} m above the ground: its center may still be below.`

/** What is kept of the Sun's disc hour by hour, and what it is used for. */
export const SUN_SHARE_KEPT = "For every hour the model also keeps the share of the Sun's disc in view. An hour counts as sunlit when any of the disc shows, and the sunlight on a panel scales with the share."

/** When a landing that fits is called marginal (lib/landingVerdict.ts, lib/sightlineSky.ts). */
export const MARGINAL_MEANS = 'A landing that fits is called marginal when the mission needs the Sun or Earth in view at landing and less than half of that disc is: its center is below the skyline.'

/** Which point of a disc an angle is measured to (the pipeline's ephemeris, and JPL Horizons). */
export const ANGLES_TO_CENTER = "Both angles are measured to the center of the disc, as JPL Horizons gives them, so a body can be in view with its center a little below the skyline."
