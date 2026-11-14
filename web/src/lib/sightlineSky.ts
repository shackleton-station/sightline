import { diskShareWords } from './answer'
import { visibleFraction } from './customModel'
import { formatDuration } from './nextChange'
import { degWords } from './sightline'

/**
 * The words for Sightline's column and time bar about one moment in the sky: what is in view, how
 * far each body is above the skyline, and what comes next. Everything here is wording over numbers
 * the app already has.
 */

/** How much of a body's disc the skyline leaves showing. */
export type DiscView = 'whole' | 'part' | 'hidden'

/** A share this close to all or nothing is all or nothing: the model cannot tell them apart. */
const WHOLE_FROM = 0.995
const HIDDEN_TO = 0.005
/** Under half the disc showing, the body's centre is below the skyline: only its edge is in view. */
export const EDGE_ONLY_UNDER = 0.5

/**
 * The share of Earth's disc above the skyline, from how far its centre is above the skyline and its
 * angular radius at that moment (Earth's size from the Moon changes with its distance). The pipeline
 * gives this share for the Sun and not for Earth, so it is worked out here the same way.
 */
export function earthShare(aboveSkylineDeg: number, radiusDeg: number): number {
  return visibleFraction(aboveSkylineDeg, radiusDeg)
}

/**
 * Whole, part or hidden, from the share showing. Where the pipeline's own hourly flag is to hand it
 * has the last word on in view or not: a disc it counts as in view is never called hidden for
 * showing a hair's breadth, and one it counts as out of view is never called partly in view.
 */
export function discView(share: number, up?: boolean): DiscView {
  if (up === false) return 'hidden'
  if (share >= WHOLE_FROM) return 'whole'
  return share <= HIDDEN_TO && up !== true ? 'hidden' : 'part'
}

/**
 * What is in view, in a few words: "Partly sunlit, Earth in view". A body whose disc the skyline
 * cuts is "partly" in view, the Sun and Earth alike. Without Earth's share (its size has not
 * loaded) Earth is in view or out of view, as the pipeline's hourly flag has it.
 */
export function stateSentence(sunShare: number, earth: number | null, earthUp: boolean): string {
  const sun = { whole: 'Sunlit', part: 'Partly sunlit', hidden: 'No sunlight' }[discView(sunShare)]
  const view = earth === null ? (earthUp ? 'whole' : 'hidden') : discView(earth, earthUp)
  return `${sun}, ${{ whole: 'Earth in view', part: 'Earth partly in view', hidden: 'Earth out of view' }[view]}`
}

/** The column's one line about the landing: "At landing: partly sunlit, Earth in view". */
export function landingSentence(sunShare: number, earth: number | null, earthUp: boolean): string {
  const said = stateSentence(sunShare, earth, earthUp)
  return `At landing: ${said[0].toLowerCase()}${said.slice(1)}`
}

/** The time bar's chip: what is up, in two or three words, saying so when only part of Earth shows. */
export function chipWords(sunUp: boolean, earthUp: boolean, earth: number | null): string {
  const partly = earthUp && earth !== null && discView(earth, true) === 'part'
  if (sunUp && earthUp) return partly ? 'Sun, part of Earth' : 'Sun and Earth'
  if (sunUp) return 'Sun only'
  if (earthUp) return partly ? 'Part of Earth' : 'Earth only'
  return 'Neither'
}

/** A row's main figure: how far the body's centre is from the skyline, and on which side. */
export function skylineFigure(aboveSkylineDeg: number): { figure: string; side: 'above the skyline' | 'below the skyline' } {
  const tenths = Math.round(aboveSkylineDeg * 10) / 10
  return { figure: degWords(Math.abs(tenths)), side: tenths < 0 ? 'below the skyline' : 'above the skyline' }
}

/**
 * What a body does next, counted from the landing: "sets in 4 d 7 h", "rises in 11 d 4 h", or, when
 * it does not set or rise again in the data, "stays in view" and the like. No year is printed.
 */
export function nextWords(body: 'Sun' | 'Earth', up: boolean, hours: number | null): string {
  if (hours === null) return body === 'Sun' ? (up ? 'stays up' : 'stays down') : up ? 'stays in view' : 'stays hidden'
  return `${up ? 'sets' : 'rises'} in ${formatDuration(hours)}`
}

/** "26% of the disc showing", when the skyline hides part of a disc that is in view; null when it shows whole or not at all. */
export function showingWords(share: number | null, up: boolean): string | null {
  return share !== null && discView(share, up) === 'part' ? `${diskShareWords(share)} of the disc showing` : null
}

/** The Sun row's small line: "sets in 4 d 7 h · 359 W/m²". The share of a cut disc is a line of its own (`showingWords`). */
export function sunLine(up: boolean, hours: number | null, sunlightWm2: number): string {
  return `${nextWords('Sun', up, hours)} · ${Math.round(sunlightWm2)} W/m²`
}

/** The Earth row's small line: "sets in 6 d 3 h". */
export function earthLine(up: boolean, hours: number | null): string {
  return nextWords('Earth', up, hours)
}

/** The Ground row's small line, and whether it fails the mission's limit. */
export function groundLine(slopeDeg: number, limitDeg: number): { text: string; fails: boolean } {
  const fails = slopeDeg > limitDeg
  return { text: fails ? `steeper than your ${limitDeg}° limit` : `within your ${limitDeg}° limit`, fails }
}

/**
 * Why a landing that meets every limit is still only marginal, one plain line each: a sliver of the
 * Sun, or only the edge of Earth, at landing. Empty when it is neither, or the shares are not known.
 */
export function marginalReasons(sunShare: number | null, earth: number | null, earthUp: boolean): string[] {
  const reasons: string[] = []
  if (sunShare !== null && sunShare > 0 && sunShare < EDGE_ONLY_UNDER) reasons.push(`${diskShareWords(sunShare)} of the Sun's disc is in view at landing`)
  if (earthUp && earth !== null && earth < EDGE_ONLY_UNDER) reasons.push('only the edge of Earth is in view at landing')
  return reasons
}

/**
 * A reason a landing does not fit, on one line, in the column's own words ("skyline", not "terrain").
 * The app's reasons (lib/mission.ts) are full sentences; this keeps their numbers and drops the rest.
 * A reason it does not know is kept as it is, without its full stop.
 */
export function shortReason(problem: string): string {
  const gap = /^(The Sun|Earth) is (gone|less than ([\d.]+)° above the terrain) for (\d+) h during the mission; your limit is (\d+) h\.$/.exec(problem)
  if (gap) {
    const sun = gap[1] === 'The Sun'
    const what = sun ? 'down' : gap[3] ? `under ${gap[3]}° above the skyline` : 'out of view'
    return `${sun ? 'Sun' : 'Earth'} ${what} for ${gap[4]} h; your limit is ${gap[5]} h`
  }
  const low = /^Earth is less than ([\d.]+)° above the terrain at landing\.$/.exec(problem)
  if (low) return `Earth under ${low[1]}° above the skyline at landing`
  if (problem === 'The Sun is down at landing.') return 'Sun down at landing'
  if (problem === 'Earth is out of view at landing.') return 'Earth out of view at landing'
  if (problem === 'The mission runs past the end of the data.') return 'Mission runs past the end of the data'
  const slope = /^The ground slopes ([\d.]+)°; your limit is (\d+)°\.$/.exec(problem)
  if (slope) return `Ground slopes ${slope[1]}°; your limit is ${slope[2]}°`
  return problem.replace(/\.$/, '')
}

/** "1 June · 18:00", for the next landing that fits: the year only when it is not the landing's own. */
export function shortWhen(clockTime: string, landingYear: string): string {
  return clockTime.replace(/ UTC$/, '').replace(` ${landingYear} ·`, ' ·')
}
