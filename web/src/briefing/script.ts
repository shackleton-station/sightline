import type { SiteInfo, TrackPoint } from '../data/contract'
import { monthSpans } from '../lib/grid'
import { type Cell, cellAt, cellsUpAt, cellsWithSunAtLeast, type LightMeta, type LightMonth, rangeWords, spotAt } from '../lib/lightGrid'
import { locateHour, type Requirements } from '../lib/mission'
import { entryAt, measureEntry, rankOptions } from '../lib/shortlist'
import { type Landing, landingAt, monthAnswer, viableFor } from '../planner/monthAnswer'
import type { PlannerSite } from '../planner/plannerModel'
import type { LightView } from '../three/lightLayer'

/**
 * The briefing's script: seven chapters, each a camera stop, a way of coloring the ground and a
 * few sentences. Every number in a caption is counted here from the pipeline's data (the site
 * tracks, the hourly flags, the light grid and its validation file); no caption has a number
 * typed into it.
 */

export interface Chapter {
  id: 'question' | 'pole' | 'month' | 'both' | 'sites' | 'sure' | 'recommendation'
  title: string
  /** Where the camera goes: the whole Moon, the south pole, or the chapter's site. */
  camera: 'moon' | 'pole' | 'site'
  /** The site the camera, the Sun and the pin belong to in this chapter. */
  siteId: string
  /** The month on show; the last chapter moves to the landing's month if that is another one. */
  month: string
  layer: LightView
  /** The hours of the month shown: one hour, or a sweep from the first to the second. */
  hours: [number, number]
  caption: string
  /** Mark the site's own pixel on the map. */
  pin: boolean
}

/** What the last chapter recommends. */
export interface Recommendation {
  site: SiteInfo
  landing: Landing
  /** The landing's month and its hour within it. */
  month: string
  index: number
  /** False when no landing works in the month on show and this is the first one after it. */
  inMonth: boolean
  /** Why it is first among the sites, in the shortlist's own words. */
  reasons: string[]
}

export interface BriefingInput {
  /** The site the story follows: the link's, if it is one of the candidates. */
  focus: SiteInfo
  month: string
  /** The hour of the month on show when the briefing was opened. */
  hour: number
  /** The focus site's hourly track for the month. */
  track: TrackPoint[]
  requirements: Requirements
  /** The listed sites the recommendation chooses among, with their hourly flags. */
  candidates: PlannerSite[]
  /** The light grid for the month, if this build has one. */
  grid: { meta: LightMeta; month: LightMonth } | null
  /** How the grid compared with NASA's map: pixels compared, and the mean absolute difference in points. */
  validation: { pixels: number; sunMeanAbs: number } | null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "May 2027" from "2027-05", with the month in full: a voice says these captions. */
export function monthWords(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

/** "13 May 2027" from an ISO time. */
function dayWords(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${monthWords(iso.slice(0, 7))}`
}

/** "13 May 2027 at 06:00 UTC" from an ISO time. */
export function whenWords(iso: string): string {
  return `${dayWords(iso)} at ${iso.slice(11, 16)} UTC`
}

/** "3%", "0.4%" or "less than 0.1%": small shares keep a digit so they don't read as nothing. */
export function shareWords(share: number): string {
  const pct = share * 100
  if (pct === 0) return 'none'
  if (pct < 0.1) return 'less than 0.1%'
  return pct < 10 ? `${pct.toFixed(1).replace(/\.0$/, '')}%` : `${Math.round(pct)}%`
}

/** "62%" or "48 to 71%" for the lowest and highest of some whole percents. */
function spanWords(values: number[]): string {
  return rangeWords([Math.min(...values), Math.max(...values)])
}

/** "A, B and C". */
function listWords(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** A month's share of hours with the Sun up, and with the Sun and Earth both up, as whole percents. */
function monthShares(site: PlannerSite, month: string): { sun: number; both: number } | null {
  const span = monthSpans(site.flags.start, site.flags.sun.length).find((candidate) => candidate.month === month)
  if (!span) return null
  let sun = 0
  let both = 0
  for (let t = span.from; t < span.to; t += 1) {
    if (site.flags.sun[t]) sun += 1
    if (site.flags.sun[t] && site.flags.earth[t]) both += 1
  }
  const hours = span.to - span.from
  return { sun: Math.round((100 * sun) / hours), both: Math.round((100 * both) / hours) }
}

/**
 * The landing to plan on. Each site's best landing in the month (the Planner's rule) is put on one
 * list and ordered by the shortlist's rule: meeting the limits, then the shortest time without the
 * Sun, then without Earth. If no site has a landing that works that month, it is the first landing
 * that works at any of them afterwards. Null if nothing in the data works.
 */
export function recommend(candidates: PlannerSite[], requirements: Requirements, month: string): Recommendation | null {
  const options = candidates.flatMap(({ site, flags }) => {
    const span = monthSpans(flags.start, flags.sun.length).find((candidate) => candidate.month === month)
    if (!span) return []
    const viable = viableFor(flags, requirements)
    const answer = monthAnswer(site, flags, requirements, span, viable)
    return [{ site, flags, viable, span, landing: answer.days > 0 ? answer.best : null }]
  })
  const found = (site: SiteInfo, flags: PlannerSite['flags'], landing: Landing, inMonth: boolean, reasons: string[]): Recommendation => {
    const { month: landingMonth, index } = locateHour(flags.start, landing.hour)
    return { site, landing, month: landingMonth, index, inMonth, reasons }
  }

  const working = options.filter((option) => option.landing !== null)
  if (working.length > 0) {
    const ranked = rankOptions(
      working.map(({ site, flags, landing }) => measureEntry({ site: site.id, at: entryAt((landing as Landing).t) }, site, flags, requirements)),
    )
    const first = ranked[0]
    const chosen = working.find((option) => option.site.id === first.site.id) as (typeof working)[number]
    return found(chosen.site, chosen.flags, chosen.landing as Landing, true, first.reasons)
  }

  // Nothing works this month: the first landing after it that does, at whichever site has it.
  let earliest: { option: (typeof options)[number]; hour: number } | null = null
  for (const option of options) {
    for (let hour = option.span.to; hour < option.viable.length; hour += 1) {
      if (!option.viable[hour]) continue
      if (!earliest || hour < earliest.hour) earliest = { option, hour }
      break
    }
  }
  if (!earliest) return null
  const { option, hour } = earliest
  return found(option.site, option.flags, landingAt(option.site, option.flags, requirements, option.viable, hour), false, [])
}

/** The briefing for a month and a mission: its chapters, and what the last one recommends. */
export function buildBriefing(input: BriefingInput): { chapters: Chapter[]; recommendation: Recommendation | null } {
  const { focus, month, track, requirements, candidates, grid, validation } = input
  const hour = Math.max(0, Math.min(input.hour, track.length - 1))
  const last = track.length - 1
  const name = monthWords(month)
  const now = track[hour].t
  const at = (id: Chapter['id'], title: string, camera: Chapter['camera'], layer: LightView, hours: [number, number], caption: string, pin = false): Chapter => ({
    id,
    title,
    camera,
    siteId: focus.id,
    month,
    layer,
    hours,
    caption,
    pin,
  })

  const chapters: Chapter[] = [
    at(
      'question',
      'The question',
      'moon',
      'light',
      [hour, hour],
      `This is the Moon on ${dayWords(now)}, lit as NASA's ephemeris has it. A lander at its south pole needs two things from the sky: the Sun for power, and Earth for its radio link. Where, and when, does it get both?`,
    ),
  ]

  if (grid) {
    const km = Math.round((2 * grid.meta.half_width_m) / 1000)
    const wellLit = cellsWithSunAtLeast(grid.month, 0.5)
    chapters.push(
      at(
        'pole',
        'The south pole',
        'pole',
        'month',
        [hour, hour],
        `This square is ${km} km of the south pole, worked out from NASA's terrain for every ${grid.meta.pixel_m} m. Brighter ground had more Sun in ${name}. ${wellLit === 0 ? 'None of it' : wellLit < 0.001 ? 'Less than 0.1% of it' : `Only ${shareWords(wellLit)} of it`} had the Sun for half the month.`,
      ),
    )
  }

  const highest = Math.max(...track.map((point) => point.sun_el))
  chapters.push(
    at(
      'month',
      'One month of light',
      'pole',
      'light',
      [0, last],
      `Here is ${name}, hour by hour. The Sun circles the horizon once a month. At ${focus.name} it ${
        highest >= 0 ? `never climbs more than ${highest.toFixed(1)}° above eye level` : `stays at least ${(-highest).toFixed(1)}° below eye level`
      }, so one hill can hide it for days.`,
    ),
  )

  if (grid) {
    const up = cellsUpAt(grid.month, hour)
    chapters.push(
      at(
        'both',
        'Power and radio',
        'pole',
        'both',
        [hour, hour],
        `Now the same ground on ${whenWords(now)}, colored by what it can see. Green sees the Sun and Earth, yellow only the Sun, blue only Earth. ${up.both === 0 ? 'None' : up.both < 0.001 ? 'Less than 0.1%' : shareWords(up.both)} of the square sees both at this hour.`,
      ),
    )
  }

  const shares = candidates.flatMap((candidate) => monthShares(candidate, month) ?? [])
  if (shares.length > 0) {
    const names = candidates.map((candidate) => candidate.site.name)
    chapters.push(
      at(
        'sites',
        'The sites',
        // The caption names every ridge, so the camera stays where all of them are in view.
        'pole',
        'month',
        [hour, hour],
        `We follow ${names.length === 1 ? 'one ridge' : `${names.length} ridges`} from NASA's published data: ${listWords(names)}. In ${name} ${names.length === 1 ? 'it' : 'they'} had the Sun for ${spanWords(shares.map((share) => share.sun))} of the hours, and the Sun and Earth together for ${spanWords(shares.map((share) => share.both))}.`,
      ),
    )
  }

  const cell: Cell | null = grid ? cellAt(grid.meta, focus.lat, focus.lon) : null
  if (grid && cell) {
    const spot = spotAt(grid.month, cell)
    const [low, high] = spot.nearby.pctSun
    const around = Math.round(low) === Math.round(high) ? `is ${Math.round(low)}% all round` : `runs from ${Math.round(low)} to ${Math.round(high)}%`
    const millions = (validation ? validation.pixels / 1e6 : 0).toFixed(1).replace(/\.0$/, '')
    const checked = validation ? ` Checked against NASA's own map across ${millions} million pixels, ours is within ${validation.sunMeanAbs.toFixed(1)} points on average.` : ''
    chapters.push(
      at(
        'sure',
        'How sure',
        'site',
        'month',
        [hour, hour],
        `A site's number is one point: within ${grid.meta.pixel_m} m of ${focus.name} the month's Sun ${around}, so we give ranges.${checked}`,
        true,
      ),
    )
  }

  const recommendation = recommend(candidates, requirements, month)
  const mission = `a ${requirements.missionDays}-day mission that can go ${requirements.maxSunGapH} h without the Sun and ${requirements.maxEarthGapH} h without Earth`
  const closing = (): Pick<Chapter, 'siteId' | 'month' | 'hours' | 'caption'> => {
    if (!recommendation) {
      return {
        siteId: focus.id,
        month,
        hours: [hour, hour],
        caption: `No landing in our data survives ${mission} at ${candidates.length === 1 ? 'this site' : 'any of these sites'}. The Planner shows what each limit costs.`,
      }
    }
    const { site, landing } = recommendation
    const sun = landing.sunGapH === 0 ? 'The Sun never sets during the mission' : `The Sun is never gone for more than ${landing.sunGapH} h`
    const earth = landing.earthGapH === 0 ? 'Earth never leaves view' : `Earth for no more than ${landing.earthGapH} h`
    const facts = landing.sunGapH === null || landing.earthGapH === null ? '' : `${sun}, and ${earth}.`
    const lead = recommendation.inMonth
      ? `Our recommendation for ${mission}: land at ${site.name} on ${whenWords(landing.t)}.`
      : `No landing in ${name} survives ${mission} at ${candidates.length === 1 ? 'this site' : 'any of these sites'}. The first that does is at ${site.name}, on ${whenWords(landing.t)}.`
    const slack = landing.roomH >= 24 ? ` The landing can slip ${Math.floor(landing.roomH / 24)} ${Math.floor(landing.roomH / 24) === 1 ? 'day' : 'days'} and still work.` : ''
    return { siteId: site.id, month: recommendation.month, hours: [recommendation.index, recommendation.index], caption: `${lead} ${facts}${slack}`.trim() }
  }
  chapters.push({ id: 'recommendation', title: 'The recommendation', camera: 'site', layer: 'both', pin: true, ...closing() })

  return { chapters, recommendation }
}

/** The hour of the month a chapter shows, `progress` (0 to 1) of the way through it. */
export function hourAt(chapter: Chapter, progress: number): number {
  const [from, to] = chapter.hours
  return Math.round(from + (to - from) * Math.max(0, Math.min(1, progress)))
}

const MS_PER_WORD = 400
const MIN_CHAPTER_MS = 9000

/** How long a chapter stays up with no voice: about the time it takes to say its caption aloud. */
export function chapterMs(chapter: Chapter): number {
  return Math.max(MIN_CHAPTER_MS, chapter.caption.split(/\s+/).length * MS_PER_WORD)
}
