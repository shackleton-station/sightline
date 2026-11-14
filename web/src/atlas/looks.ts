/**
 * The Atlas comes in three looks, from the design canvas of 2026-11-13 (docs/ATLAS_LOOKS.md):
 * A Observatory (the Atlas refined), B Mission Control (docked panels), C Night Glass (one bottom dock).
 * The data, the controls and what they do are the same in all three; only colors, type and layout change.
 */
export type Look = 'a' | 'b' | 'c'

export const LOOKS: { id: Look; name: string }[] = [
  { id: 'a', name: 'Observatory' },
  { id: 'b', name: 'Mission Control' },
  { id: 'c', name: 'Night Glass' },
]

/** The look a link asks for ("&look=b"); Observatory when it names none or one we don't have. */
export function lookFrom(hash: string): Look {
  const asked = new URLSearchParams(hash.replace(/^#/, '')).get('look')
  return LOOKS.find((option) => option.id === asked)?.id ?? 'a'
}

/** How much of the Sun is up: all of its disk, part of it (on the horizon), or none. */
export type SunState = 'sun' | 'horizon' | 'shadow'

/**
 * The Sun's state from the fraction of its disk in view (0–1, from the pipeline's track).
 * A tapped spot only knows up or not, so it passes no fraction and gets "sun" or "shadow".
 */
export function sunState(up: boolean, fraction?: number): SunState {
  if (!up) return 'shadow'
  return fraction !== undefined && fraction < 1 ? 'horizon' : 'sun'
}

export const SUN_WORDS: Record<SunState, string> = {
  sun: 'Sun in view',
  horizon: 'Sun on the horizon',
  shadow: 'Sun hidden by terrain',
}
