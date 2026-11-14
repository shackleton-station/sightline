/**
 * Scout's tour of Sightline. The steps live in one file, `src/sightline/tour.json`, which the page,
 * How it works, the voice renderer (`scripts/tour-voice.mjs`) and the tutorial video's recorder all
 * read. This file is the shape of that data and the one piece of geometry the tour needs: where
 * Scout's bubble may sit.
 */

/** What a step puts the screen in before it speaks. */
export interface TourState {
  /** Watch (the Moon alone) or Plan (the frame around it, on the tour's scenario). */
  view: 'watch' | 'plan'
  /** A site whose marker is ringed on the Moon, the way a reply of Scout's rings one. */
  ring?: string
  /** A strip that must be open for the step: the skyline, or the time bar. */
  show?: 'skyline' | 'time'
  /** Something the step opens to talk about it: the Compare or Layers panel, the form for a custom point, the Share list, or the Planner on one of its tabs. */
  open?: GuidePanel | 'planner-find' | 'planner-compare'
  /** The step is about more than one scenario: the app's two nearby sites on one date are put in, once, for it. */
  pair?: boolean
}

/** What a feature guide can open, and so which panel offers that guide ("Show me how"). */
export type GuidePanel = 'compare' | 'layers' | 'custom' | 'share'

/** A feature guide: a short tour of one feature, in the main tour's own format. */
export interface FeatureGuide {
  id: string
  /** Its name in the Guide. */
  name: string
  /** One line under its name in the Guide. */
  about: string
  /** The panel whose header offers it. */
  panel?: GuidePanel
  steps: TourStep[]
}

export interface GuidesFile {
  guides: FeatureGuide[]
}

export interface TourStep {
  id: string
  title: string
  /** What Scout says: one or two short sentences, shown in his bubble and spoken when "Listen" is on. */
  say: string
  state: TourState
  /** CSS selectors of what the step is about. Every match that is on screen gets a ring. */
  targets: string[]
  /** Something ready to try from the step's bubble: two nearby sites on one date, set side by side in Compare. */
  offers?: 'nearby-pair'
  /** The step is about a control only a wide window has (the zoom buttons): it is left out on a phone. */
  wide?: boolean
}

export interface TourFile {
  name: string
  voice: { disclosure: string; files: string; from: string }
  /** The walkthrough video's files, under /media/, with where its chapters are read from. The Guide shows the player only once the file answers. */
  video: { file: string; poster: string; captions: string; chapters: string; steps: string }
  /** The 30-second demo's files, shown the same way. */
  demo: { file: string; poster: string; captions: string }
  /** The landing the tour plans from its first Plan step on. */
  scenario: { site: string; landing: string }
  steps: TourStep[]
}

/** Where a step's spoken line is served from. */
export function voiceFile(tour: TourFile, step: TourStep): string {
  return tour.voice.files.replace('<id>', step.id)
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The Moon's disc on screen. */
export interface Disc {
  x: number
  y: number
  r: number
}

const overlaps = (a: Box, b: Box, gap = 0) => a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top

/** Whether a box touches a disc: the distance from the disc's centre to the nearest point of the box. */
export function overDisc(box: Box, disc: Disc | null): boolean {
  if (!disc) return false
  const x = Math.min(Math.max(disc.x, box.left), box.left + box.width)
  const y = Math.min(Math.max(disc.y, box.top), box.top + box.height)
  return Math.hypot(x - disc.x, y - disc.y) < disc.r
}

/** How far from the window's edges the bubble keeps, and from what it is about, in pixels. */
const EDGE = 12
const CLEAR = 8

/**
 * Where Scout's bubble sits for a step: the first of a few fixed places that covers neither the
 * Moon's disc nor anything the step rings. On a laptop that is the lower left corner, where Scout
 * lives in Watch and where Plan's column is empty (so it stands beside the column and the strips the
 * steps ring, and "Next" stays in one place from step to step), then the other corners. On a phone it is the foot
 * of the screen, then just above the lowest thing ringed, then the top. If every place covers
 * something, the Moon's disc is the one thing still never covered; the place that hides the least
 * of what is ringed wins.
 */
export function placeBubble(size: { width: number; height: number }, window: { width: number; height: number }, rings: Box[], disc: Disc | null, phone: boolean): { left: number; top: number } {
  const right = window.width - size.width - EDGE
  const bottom = window.height - size.height - EDGE
  const lowest = rings.reduce<Box | null>((low, ring) => (!low || ring.top > low.top ? ring : low), null)
  const places = phone
    ? [
        { left: EDGE, top: bottom },
        ...(lowest ? [{ left: EDGE, top: lowest.top - size.height - CLEAR }] : []),
        { left: EDGE, top: EDGE },
      ]
    : [
        { left: EDGE, top: bottom },
        { left: right, top: bottom },
        { left: EDGE, top: EDGE },
        { left: right, top: EDGE },
      ]
  const inWindow = places.filter((place) => place.top >= 0 && place.left >= 0)
  const boxAt = (place: { left: number; top: number }): Box => ({ ...place, ...size })
  const clear = inWindow.find((place) => !overDisc(boxAt(place), disc) && !rings.some((ring) => overlaps(boxAt(place), ring, CLEAR)))
  if (clear) return clear
  const hidden = (place: { left: number; top: number }) =>
    rings.reduce((sum, ring) => {
      const box = boxAt(place)
      const w = Math.min(box.left + box.width, ring.left + ring.width) - Math.max(box.left, ring.left)
      const h = Math.min(box.top + box.height, ring.top + ring.height) - Math.max(box.top, ring.top)
      return sum + (w > 0 && h > 0 ? w * h : 0)
    }, 0)
  const offDisc = inWindow.filter((place) => !overDisc(boxAt(place), disc))
  return [...(offDisc.length > 0 ? offDisc : inWindow.length > 0 ? inWindow : places)].sort((a, b) => hidden(a) - hidden(b))[0]
}
