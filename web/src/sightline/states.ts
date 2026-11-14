import type { RiverState } from '../lib/river'

/** The state in two or three words, for the chip beside the time bar's date. */
export const STATE_CHIP: Record<RiverState, string> = {
  both: 'Sun and Earth',
  sun: 'Sun only',
  earth: 'Earth only',
  none: 'Neither',
}

/** Where each state sits in a row, so the river reads without colour: both fills it, the Sun the top, Earth the bottom, neither a thin line. */
export const BAND = { both: { y: 0, height: 12 }, sun: { y: 0, height: 8 }, earth: { y: 4, height: 8 }, none: { y: 5, height: 2 } }
