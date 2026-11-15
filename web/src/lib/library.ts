import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import { hourOf, locateHour, missionEarth } from './mission'
import { fitProblems, type SightlineMission, type SightlineScenario } from './sightlineMission'
import { parseCustomSite } from './urlState'

/**
 * The library: scenarios other people saved, to search, filter and add to the plan on screen.
 *
 * The plans service sends every listed scenario as a place and a landing time (web/plans/API.md,
 * "The library"). Everything else on a card is worked out here, from the same hourly flags the
 * rest of the screen uses and against the visitor's own mission: a scenario saved for a short stay
 * is judged for a long one if that is the mission on screen.
 */

/** One scenario of one saved plan, as the service sends it. */
export interface LibraryEntry {
  plan: string
  title: string
  saved: string
  site: string
  landing: string
}

/** What is in view during a stretch of the mission. */
export type BandState = 'both' | 'sun' | 'earth' | 'none'

/** A stretch of the mission with one state, as shares of the mission from 0 to 1. */
export interface Band {
  state: BandState
  from: number
  to: number
}

/** A scenario from the library, measured against the mission on screen. */
export interface LibraryCard {
  /** Names this card: the plan and the scenario's place in it. */
  key: string
  entry: LibraryEntry
  /** How many listed plans hold this same landing, the place and the hour: 1 when only this one does. Counted by `filterCards`. */
  copies: number
  /** The scenario as the screen holds one; null when its landing is outside the data. */
  scenario: SightlineScenario | null
  /** The site's name, or the coordinates of a custom point. */
  place: string
  /** The listed site; null for a custom point, which has no flags until it is in the plan. */
  site: SiteInfo | null
  /** The landing's month, as "2027-06". */
  month: string
  /** Whether this landing fits the mission; null when it cannot be told here (a custom point, or outside the data). */
  fits: boolean | null
  problems: string[]
  /** Share of that month's days, at that site, with a landing that fits the mission, 0 to 1; null when not known. */
  monthShare: number | null
  /** The mission from this landing, as stretches of Sun, Earth, both or neither; null when not known. */
  bands: Band[] | null
  /** Share of the mission with the Sun up, and with Earth in view, 0 to 1. */
  sunShare: number | null
  earthShare: number | null
}

/** A listed site with its hourly flags. */
interface Flagged {
  site: SiteInfo
  flags: SiteFlags
}

/** The grid's answer for one site and month: the share of the month's days with a landing that fits. */
export type MonthShares = (siteId: string, month: string) => number | null

const stateAt = (sun: boolean, earth: boolean): BandState => (sun && earth ? 'both' : sun ? 'sun' : earth ? 'earth' : 'none')

/** The mission from `landing`, hour by hour, joined into stretches of one state. Stops at the end of the data. */
export function bandsOf(sun: boolean[], earth: boolean[], landing: number, missionHours: number): Band[] {
  const end = Math.min(landing + missionHours, sun.length)
  const bands: Band[] = []
  for (let hour = landing; hour < end; hour += 1) {
    const state = stateAt(sun[hour], earth[hour])
    const last = bands.at(-1)
    const to = (hour + 1 - landing) / missionHours
    if (last && last.state === state) last.to = to
    else bands.push({ state, from: (hour - landing) / missionHours, to })
  }
  return bands
}

/** The share of the mission spent in any of `states`. */
export function shareOf(bands: Band[], states: BandState[]): number {
  return bands.filter((band) => states.includes(band.state)).reduce((sum, band) => sum + band.to - band.from, 0)
}

/** A custom point's coordinates in words, as the brief writes them: "89.50° S, 120.00° E". */
function pointWords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`
}

/** Every entry as a card, measured against the mission. Entries the app could never open (an unknown site) are left out. */
export function cardsOf(entries: LibraryEntry[], start: string, hours: number, sites: Flagged[], mission: SightlineMission, monthShare: MonthShares): LibraryCard[] {
  const seen = new Map<string, number>()
  return entries.flatMap((entry): LibraryCard[] => {
    const nth = seen.get(entry.plan) ?? 0
    seen.set(entry.plan, nth + 1)
    const point = parseCustomSite(entry.site)
    const listed = sites.find((one) => one.site.id === entry.site) ?? null
    if (!point && !listed) return []
    const landing = hourOf(start, entry.landing)
    const inData = Number.isInteger(landing) && landing >= 0 && landing < hours
    const month = inData ? locateHour(start, landing).month : entry.landing.slice(0, 7)
    const base = { key: `${entry.plan}.${nth}`, entry, copies: 1, scenario: inData ? { site: entry.site, landing } : null, month }
    if (!listed || !inData) {
      return [{ ...base, place: listed ? listed.site.name : point ? `Custom point, ${pointWords(point.lat, point.lon)}` : entry.site, site: listed?.site ?? null, fits: null, problems: [], monthShare: null, bands: null, sunShare: null, earthShare: null }]
    }
    const { site, flags } = listed
    const problems = fitProblems(flags, landing, mission, site.slope?.deg ?? null)
    const bands = bandsOf(flags.sun, missionEarth(flags, mission.requirements), landing, mission.requirements.missionDays * 24)
    return [{ ...base, place: site.name, site, fits: problems.length === 0, problems, monthShare: monthShare(site.id, month), bands, sunShare: shareOf(bands, ['both', 'sun']), earthShare: shareOf(bands, ['both', 'earth']) }]
  })
}

/** What the visitor has asked the library to show. */
export interface LibraryFilters {
  /** Words to find in a plan's name or a place's name. */
  words: string
  /** A listed site's id, or '' for every place. */
  site: string
  /** The first and last landing month to show, as "2027-06"; '' leaves that end open. */
  from: string
  to: string
  /** Only landings that fit the mission on screen. */
  fitsOnly: boolean
  /** At least this share of the landing's month has a day that fits, in percent; 0 shows all. */
  minMonthPct: number
  /** One card for each landing: the same place and hour saved in several plans is shown once, from the newest of them. On unless switched off. */
  oneEach: boolean
}

export const NO_FILTERS: LibraryFilters = { words: '', site: '', from: '', to: '', fitsOnly: false, minMonthPct: 0, oneEach: true }

/** Whether any filter is set. */
export function filtering(filters: LibraryFilters): boolean {
  return (Object.keys(NO_FILTERS) as (keyof LibraryFilters)[]).some((name) => filters[name] !== NO_FILTERS[name])
}

/** The cards the filters let through, in the order given. Every word typed must be in the plan's name or the place's. */
export function filterCards(cards: LibraryCard[], filters: LibraryFilters): LibraryCard[] {
  const words = filters.words.toLowerCase().split(/\s+/).filter(Boolean)
  const passed = cards.filter((card) => {
    const text = `${card.entry.title} ${card.place}`.toLowerCase()
    if (!words.every((word) => text.includes(word))) return false
    if (filters.site && card.entry.site !== filters.site) return false
    if (filters.from && card.month < filters.from) return false
    if (filters.to && card.month > filters.to) return false
    if (filters.fitsOnly && card.fits !== true) return false
    if (filters.minMonthPct > 0 && (card.monthShare === null || card.monthShare * 100 < filters.minMonthPct)) return false
    return true
  })
  // How many plans hold each landing is counted over the whole library, not over what the other filters let through.
  const landing = (card: LibraryCard) => `${card.entry.site}@${card.entry.landing}`
  const held = new Map<string, number>()
  for (const card of cards) held.set(landing(card), (held.get(landing(card)) ?? 0) + 1)
  const counted = passed.map((card) => ({ ...card, copies: held.get(landing(card)) ?? 1 }))
  if (!filters.oneEach) return counted
  // The first of each landing is kept: the library comes newest plan first, so that is the newest plan's.
  const seen = new Set<string>()
  return counted.filter((card) => !seen.has(landing(card)) && seen.add(landing(card)))
}

/**
 * The plan's own scenarios as entries, so the tray (the plan, as cards) is drawn and measured the
 * way the library's cards are. There is no separate tray to remember: a landing added from the
 * library is a scenario of the plan, A to D, and is on the main screen with the others.
 */
export function planEntries(scenarios: SightlineScenario[], start: string): LibraryEntry[] {
  return scenarios.map((scenario) => ({ plan: 'your-plan', title: 'your plan', saved: '', site: scenario.site, landing: new Date(Date.parse(start) + scenario.landing * 3_600_000).toISOString().replace('.000Z', 'Z') }))
}
