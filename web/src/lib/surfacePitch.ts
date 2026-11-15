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

/**
 * A view's pitch kept where the skyline under its body is still in the picture: no more than
 * `share` of the picture's height above the middle. Facing a body far under the land, the view would
 * otherwise tip down until the picture is ground alone; this way the skyline stays in its upper part
 * and the body's name is pinned to the lower edge.
 */
export function withSkyline(pitchDeg: number, skylineElDeg: number, look: Pick<Look, 'fovDeg' | 'stretch'>, share: number): number {
  return Math.max(pitchDeg, skylineElDeg - (look.fovDeg / look.stretch) * share)
}

/** Where a body's name and its two lines go (the name's baseline, px), and whether they point at a body out of sight. */
export interface TagPlace {
  nameY: number
  points: 'down' | 'up' | null
}

/** The name's baseline sits this far above a disk's top, or this far under its bottom (px). */
const TAG_ABOVE_PX = 46
const TAG_UNDER_PX = 26
/** The three lines reach this far above and below the name's baseline (px). */
const TAG_RISE_PX = 12
const TAG_DROP_PX = 37

/**
 * A body's name goes above its disk, or under it where that would run into the menus and compass.
 * Where the disk is under what covers the foot of the picture, or off the picture altogether, the
 * name is pinned at that edge and points the way, so a body far under the land is still named.
 */
export function tagPlace(cy: number, ry: number, height: number, clearTopPx: number, clearBottomPx: number): TagPlace {
  const above = cy - ry - TAG_ABOVE_PX > clearTopPx + 18
  const nameY = above ? cy - ry - TAG_ABOVE_PX : cy + ry + TAG_UNDER_PX
  const highest = clearTopPx + 18 + TAG_RISE_PX
  const lowest = Math.max(height - clearBottomPx - TAG_DROP_PX, highest)
  if (nameY > lowest) return { nameY: lowest, points: cy > lowest + TAG_DROP_PX ? 'down' : null }
  if (nameY < highest) return { nameY: highest, points: cy < highest - TAG_RISE_PX ? 'up' : null }
  return { nameY, points: null }
}
