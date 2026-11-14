import type { Requirements } from '../../src/lib/mission'

/** The limits a fresh visit starts with (the same as the app's own example). */
export const DEFAULT_LIMITS: Requirements = {
  missionDays: 14,
  maxSunGapH: 72,
  maxEarthGapH: 72,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}
