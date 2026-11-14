import { project, type Vec3 } from './polarCamera'

/**
 * The Moon's view in Sightline belongs to the visitor: once they turn or zoom it, it stays exactly
 * there. These helpers say when a view has been moved from the default, which way, and what little
 * has to change when the stage changes size so the disc is not cut off.
 */

/** A view of the Moon: the point in the middle, which way is up the screen, and the zoom (1 fits the Moon in the globe's square). */
export interface MoonPose {
  center: Vec3
  up: Vec3
  zoom: number
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Turned by less than this (about 0.2°), a view counts as the default direction. */
const SAME_DIRECTION = 1 - 6e-6
/** Zoomed by less than this share, a view counts as the default zoom. */
const SAME_ZOOM_SHARE = 0.01

/** Whether a view has been turned or zoomed away from the default one. */
export function viewMoved(pose: MoonPose, defaults: MoonPose): boolean {
  const turned = dot(pose.center, defaults.center) < SAME_DIRECTION || dot(pose.up, defaults.up) < SAME_DIRECTION
  const zoomed = Math.abs(pose.zoom - defaults.zoom) > defaults.zoom * SAME_ZOOM_SHARE
  return turned || zoomed
}

/**
 * Where the recentre compass's needle points, in degrees clockwise from up the screen: the way the
 * default view's "up" now lies on the screen. 0 at the default view; 90 when the picture has been
 * turned a quarter turn clockwise.
 */
export function needleDeg(pose: Pick<MoonPose, 'center' | 'up'>, defaultUp: Vec3): number {
  const { x, y } = project(defaultUp, pose.center, pose.up)
  if (Math.hypot(x, y) < 1e-9) return 0
  return (Math.atan2(x, y) * 180) / Math.PI
}

/**
 * The zoom to use after the stage changes size. A view still at the whole-Moon fit keeps fitting:
 * it takes the new fit, so the disc is never cut off. A view the visitor zoomed keeps the ground at
 * the same size on screen (the same pixels across the Moon), and never goes below the new fit.
 */
export function refitZoom(zoom: number, before: { side: number; wholeZoom: number }, now: { side: number; wholeZoom: number; farZoom?: number }): number {
  if (before.side === 0 || Math.abs(zoom - before.wholeZoom) <= before.wholeZoom * SAME_ZOOM_SHARE) return now.wholeZoom
  // A view the visitor zoomed out past the fit keeps its size too, down to the furthest the stage allows.
  return Math.max(now.farZoom ?? now.wholeZoom, (zoom * before.side) / now.side)
}
