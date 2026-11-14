/**
 * The empty sky beside the whole Moon on Sightline's stage: where the Moon's disc is when it is
 * fitted to the stage, and how tall a card standing in a lower corner can be without touching it.
 * Lengths are CSS pixels, measured from the stage's top left corner.
 */

/** The whole Moon takes this share of the shorter side of the stage's free room, centred in it. */
export const WHOLE_MOON_SHARE = 0.9

export interface Disc {
  cx: number
  cy: number
  r: number
}

/** The whole Moon's disc on a stage of this size: centred in the room above what is kept clear at the bottom. */
export function wholeMoonDisc(width: number, height: number, reserveBottom: number): Disc {
  const free = Math.max(height - reserveBottom, 0)
  return { cx: width / 2, cy: free / 2, r: (Math.min(width, free) * WHOLE_MOON_SHARE) / 2 }
}

/**
 * The tallest a card left of the Moon can be: its right edge at `right`, its bottom edge at `bottom`,
 * its top no higher than `top`, and `gap` of sky kept between it and the disc. Where the disc does
 * not reach over the card's column the card may run from `bottom` to `top`; where it does, the
 * card's upper right corner stays under the disc's edge.
 */
export function tallestBesideMoon(disc: Disc, right: number, bottom: number, top: number, gap: number): number {
  const reach = disc.r + gap
  const aside = disc.cx - right
  if (aside >= reach) return Math.max(bottom - top, 0)
  if (bottom <= disc.cy) return 0
  const under = disc.cy + Math.sqrt(Math.max(reach * reach - aside * aside, 0))
  return Math.max(bottom - Math.max(top, under), 0)
}
