import { isNoGapLimit } from './mission'
import { PRESETS } from './sightlineMission'

/**
 * What the Canadian Space Agency says about its lunar utility rover, word for word, from its own
 * page (read 2026-11-13; the page says "Date modified: 2026-09-03"). Nothing else about the rover
 * is claimed anywhere in the app, and the agency has published no landing site.
 *
 * The quotation keeps the agency's own words "lunar night"; the app's own text never uses them.
 */
export const CSA_ROVER = {
  url: 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/canadian-utility-rover-on-the-moon.asp',
  pageTitle: 'A Canadian utility rover on the Moon',
  modified: '2026-09-03',
  status: 'Concept development',
  launch: 'In the 2030s',
  survive: 'survive the roughly two-week-long lunar night, with temperatures as low as -200 °C',
  use: 'surveying for ice or other resources',
} as const

/** The mission the idea selects: the app's own "Long stay" example, which is not the rover's real figures. */
export const ROVER_PRESET = PRESETS.find((preset) => preset.id === 'long')!

/** What the Long stay asks for, in whole days, for the panel's sentence. `silent` is null when it sets no limit on time without Earth. */
export function roverMissionDays(): { stay: number; dark: number; silent: number | null } {
  const { missionDays, maxSunGapH, maxEarthGapH } = ROVER_PRESET.mission.requirements
  return { stay: missionDays, dark: Math.round(maxSunGapH / 24), silent: isNoGapLimit(maxEarthGapH) ? null : Math.round(maxEarthGapH / 24) }
}
