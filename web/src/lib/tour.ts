/**
 * Scout's tour of Sightline. Its steps live in one file, `src/sightline/tour5.json`, which the page,
 * the Guide and the voice renderer (`scripts/tour-voice.mjs`) all read; the feature guides are in
 * `guides.json`, and `tour.json` holds the walkthrough video's steps and files. This file is the
 * shape of that data and the one piece of geometry the tour needs: where Scout's card may sit.
 */

/** What a step puts the screen in before it speaks. */
export interface TourState {
  /** Watch (the Moon alone) or Plan (the frame around it, on the tour's scenario). */
  view: 'watch' | 'plan'
  /** A site whose marker is ringed on the Moon, the way a reply of Scout's rings one. */
  ring?: string
  /** A strip that must be open for the step: the skyline, or the time bar. */
  show?: 'skyline' | 'time'
  /**
   * Something the step opens to talk about it: the Compare or Layers panel, the form for a custom
   * point, the Share list, or the Planner on one of its tabs. The tour also opens the
   * Landing accuracy panel, Scout's panel, the Guide at its proof, the mission's limits in the
   * plan's column, and the written brief.
   */
  open?: GuidePanel | 'planner-find' | 'planner-compare' | 'accuracy' | 'scout' | 'proof' | 'mission' | 'brief'
  /** The step is about more than one scenario: the app's two nearby sites on one date are put in, once, for it. */
  pair?: boolean
  /** The step is about the Long stay example: the mission is set to it for the guide, and put back on leaving. The tour sets the Short stay, so it says the same on every screen. */
  mission?: 'long' | 'short'
  /** The plan the step is about, put in on arriving at it: its scenarios, the first one on show. Left out, the plan stays as the step before left it. */
  scenarios?: { site: string; landing: string }[]
  /** Which of those scenarios is on show, counted from 0, when it is not the first. */
  active?: number
  /** The view of the Moon for the step: Orbit unless it says the Site view, or Surface (standing at the site), which opens the skyline strip under it when the step shows the skyline. */
  stage?: 'site' | 'surface'
  /** Time plays while the step is on. */
  play?: boolean
  /** On a phone the sheet opens to its full height for the step, as it does for a step that shows a strip: what it rings is too long for half a screen. */
  tall?: boolean
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
  /** The part of the tour's story the step belongs to ("The plan changes"): a small label over its title, and how its dots are grouped. */
  chapter?: string
  /** What Scout says: one or two short sentences, shown in his bubble and spoken when "Listen" is on. */
  say: string
  state: TourState
  /** CSS selectors of what the step is about. Every match that is on screen gets a ring. */
  targets: string[]
  /** Something ready to try from the step's bubble: two nearby sites on one date, set side by side in Compare. */
  offers?: 'nearby-pair'
  /** The step is about a control only a wide window has (the zoom buttons): it is left out on a phone. */
  wide?: boolean
  /** What stays at full brightness beside what is ringed, with no ring of its own: CSS selectors, or "moon" for the Moon's disc when the step is about the Moon itself. */
  lit?: string[]
  /** The card's own words, for someone who reads and never listens: two short sentences, shown in place of `say`, which is then only spoken. */
  line?: string
  /** A control the step presses itself on the first "Next" (a CSS selector), so the reader sees a before and an after; the next "Next" moves on. */
  press?: string
  /** What the step rings once that control has been pressed. */
  after?: string[]
  /** The words of `say` at which that press belongs, when the tour plays through by itself: it is made as the voice reaches them. */
  pressOn?: string
  /**
   * Where the step goes on its first "Next", for a step that moves to another part of the screen:
   * it arrives with the control a visitor would press ringed (`targets`), the first "Next" presses
   * it for them by putting the screen in `state` with these changes, and `after` is ringed there.
   * So a reader who closes the tour knows which button led where.
   */
  then?: Partial<TourState>
  /** What is lit beside the rings once the step has made its press, when that differs from `lit`. */
  afterLit?: string[]
  /** The way back from a page the step opened (a CSS selector): ringed for a moment as the reader moves on, so they see it too. */
  leave?: string
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

/** The tour: one plan followed from its first answer to a changed date, in the feature guides' format, with a voice of its own. */
export interface LongTourFile {
  name: string
  /** `seconds`: how long the tour takes played through with its voice, a second a step for stepping included; kept equal to the voice files' own lengths by a test. */
  voice: { disclosure: string; files: string; from: string; seconds: number }
  /** Files the later steps read, asked for quietly once the tour starts, so each step is ready on arrival. */
  prepare?: { files: string[] }
  steps: TourStep[]
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** "five and a half minutes": a length of time to the nearest half minute, in words. */
export function minutesWords(seconds: number): string {
  const halves = Math.max(Math.round(seconds / 30), 1)
  const whole = Math.floor(halves / 2)
  const half = halves % 2 === 1
  if (whole === 0) return 'half a minute'
  if (whole === 1) return half ? 'a minute and a half' : 'a minute'
  return `${NUMBER_WORDS[whole] ?? whole}${half ? ' and a half' : ''} minutes`
}

/** How fast a card is read, in words a minute: about an adult's usual silent pace for plain prose. */
const READ_WORDS_A_MINUTE = 230

/** How long the tour's cards take to read, since most visitors read and few listen: "about two minutes". */
export function tourReads(tour: LongTourFile): string {
  const words = tour.steps.reduce((sum, step) => sum + (step.line ?? step.say).split(/\s+/).length, 0)
  return `about ${minutesWords((words / READ_WORDS_A_MINUTE) * 60)}`
}

/** What the tour takes, from its own steps and voice, the reading time first: "15 steps: about two minutes to read, about six minutes to hear". */
export function tourTakes(tour: LongTourFile): string {
  return `${tour.steps.length} steps: ${tourReads(tour)} to read, about ${minutesWords(tour.voice.seconds)} to hear`
}

/** The hover text of every way into the tour: what it is, and what it takes. */
export function tourMeans(tour: LongTourFile): string {
  const takes = tourTakes(tour)
  return `Scout follows one landing plan across the real screen, in ${takes.replace(': about', '. About')}.`
}

/** Where a step's spoken line is served from. */
export function voiceFile(tour: { voice: { files: string } }, step: TourStep): string {
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

/** How far from the window's edges the card keeps, and from what it is about, in pixels. */
const EDGE = 12
const CLEAR = 8

/** Where the card sits: its corner of the window, and which side that is. */
export interface Place {
  left: number
  top: number
  side: 'left' | 'right'
}

/**
 * Where Scout's card sits for a step. On a laptop it has one home, the lower left corner: Scout
 * lives there in Watch, and in Plan the card lies over the foot of the plan's column, beside the
 * Moon's strips, so "Back" and "Next" stay in one place from step to step. It moves to the lower
 * right corner only where the home would cover something the step rings, and it is never sent to
 * the top: a page that fills the window makes room for it instead. The Moon's disc is kept clear
 * only when one is passed, which the tour does for a step about the Moon itself. On a phone it is
 * the foot of the screen, then just above the lowest thing ringed, then just above them all, then
 * the top. If every place covers something, the place that hides the least of what is ringed wins.
 */
export function placeBubble(size: { width: number; height: number }, window: { width: number; height: number }, rings: Box[], disc: Disc | null, phone: boolean): Place {
  const right = window.width - size.width - EDGE
  const bottom = window.height - size.height - EDGE
  const lowest = rings.reduce<Box | null>((low, ring) => (!low || ring.top > low.top ? ring : low), null)
  const highest = rings.reduce<Box | null>((high, ring) => (!high || ring.top < high.top ? ring : high), null)
  const places: Place[] = phone
    ? [
        { left: EDGE, top: bottom, side: 'left' },
        ...(lowest ? [{ left: EDGE, top: lowest.top - size.height - CLEAR, side: 'left' as const }] : []),
        ...(highest && highest !== lowest ? [{ left: EDGE, top: highest.top - size.height - CLEAR, side: 'left' as const }] : []),
        { left: EDGE, top: EDGE, side: 'left' },
      ]
    : [
        { left: EDGE, top: bottom, side: 'left' },
        { left: right, top: bottom, side: 'right' },
      ]
  const inWindow = places.filter((place) => place.top >= 0 && place.left >= 0)
  const boxAt = (place: Place): Box => ({ left: place.left, top: place.top, ...size })
  const clear = inWindow.find((place) => !overDisc(boxAt(place), disc) && !rings.some((ring) => overlaps(boxAt(place), ring, CLEAR)))
  if (clear) return clear
  const hidden = (place: Place) =>
    rings.reduce((sum, ring) => {
      const box = boxAt(place)
      const w = Math.min(box.left + box.width, ring.left + ring.width) - Math.max(box.left, ring.left)
      const h = Math.min(box.top + box.height, ring.top + ring.height) - Math.max(box.top, ring.top)
      return sum + (w > 0 && h > 0 ? w * h : 0)
    }, 0)
  const offDisc = inWindow.filter((place) => !overDisc(boxAt(place), disc))
  // Sorting keeps the places' own order between equals, so the home wins a tie.
  return [...(offDisc.length > 0 ? offDisc : inWindow.length > 0 ? inWindow : places)].sort((a, b) => hidden(a) - hidden(b))[0]
}
