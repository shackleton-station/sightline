import { framingPitch, type Look } from './surfaceView'

/** A body in one of the two views, and the top edge of the land under it (degrees above eye level). */
export interface Faced {
  bodyElDeg: number
  skylineElDeg: number
}

/** One pitch for both views, and how far each view goes toward it: 1 all the way, 0 not at all. */
export interface LevelPitch {
  pitchDeg: number
  weight: number
}

/** How far below the middle of the picture the skyline may sit, as a share of its height. */
const SKYLINE_BELOW = 0.3

/**
 * The pitch that puts eye level at the same height in both views, when both bodies and the skyline
 * under each fit in the picture at once. Side by side, the two views then read as two windows on one
 * horizon, not one picture broken at the seam.
 *
 * Each view alone would tip to `framingPitch` for its own body. The shared pitch is the mean of the
 * two, kept where every body is within `share` of the picture's height from the middle and every
 * skyline is in view under it. As that room runs out the weight falls to 0, so the views part
 * smoothly and each keeps its own pitch where they cannot both fit.
 */
export function levelPitch(views: Faced[], look: Pick<Look, 'fovDeg' | 'stretch'>, share: number): LevelPitch {
  const lens = { headingDeg: 0, pitchDeg: 0, fovDeg: look.fovDeg, stretch: look.stretch }
  const own = views.map((view) => framingPitch(view.bodyElDeg, view.skylineElDeg, lens, share))
  const mean = own.reduce((sum, pitch) => sum + pitch, 0) / Math.max(own.length, 1)
  // Near eye level a stretched picture takes in this much true elevation, bottom to top.
  const tall = look.fovDeg / look.stretch
  const reach = tall * share
  const bodies = views.map((view) => view.bodyElDeg)
  const skylines = views.map((view) => view.skylineElDeg)
  // The pitches at which every body and every skyline is where it may be.
  const lowest = Math.max(Math.max(...bodies) - reach, Math.max(...skylines) - reach)
  const highest = Math.min(Math.min(...bodies) + reach, Math.min(...skylines) + tall * SKYLINE_BELOW)
  const room = highest - lowest
  if (views.length < 2 || !(room > 0)) return { pitchDeg: mean, weight: 0 }
  return { pitchDeg: Math.min(Math.max(mean, lowest), highest), weight: Math.min(room / (reach / 2), 1) }
}

/** A view's own pitch moved toward the shared one. */
export function towardLevel(ownPitchDeg: number, level: LevelPitch | null): number {
  return level ? ownPitchDeg + (level.pitchDeg - ownPitchDeg) * level.weight : ownPitchDeg
}
