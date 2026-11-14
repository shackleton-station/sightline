import type { CalendarYearStats, MonthStats } from '../data/contract'
import type { ScenarioData } from '../data/scenarioData'
import { formatDuration } from './nextChange'
import { monthLong, monthName } from './months'
import { panelSunlight } from './power'
import { pct } from './verdict'

/** Below this monthly swing in solar elevation (degrees), a site behaves like the pole. */
const POLAR_SUN_SWING_DEG = 10
/** At or above this peak solar elevation (degrees), the Sun counts as climbing high. */
const HIGH_SUN_DEG = 30

export interface Fact {
  title: string
  text: string
}

function extreme(months: MonthStats[], better: (a: MonthStats, b: MonthStats) => boolean): MonthStats {
  return months.reduce((best, month) => (better(month, best) ? month : best))
}

/** Numbers for the calendar year of the month on show, whichever years the data covers. */
function shownYear(data: ScenarioData): { name: string; months: MonthStats[]; stats: CalendarYearStats } {
  const name = data.month.slice(0, 4)
  const stats = data.year.years.find((row) => String(row.year) === name)
  if (!stats) throw new Error(`no numbers for ${name} at ${data.site.id}`)
  return { name, months: data.year.months.filter((row) => row.month.startsWith(name)), stats }
}

/**
 * Plain-language reasons a polar site is hard, for a general audience. Every number comes from the
 * selected site's pipeline output, so the facts change with the site and month.
 */
function poleFacts(data: ScenarioData): Fact[] {
  const { site, month, horizon, track, validation, summary } = data
  const year = shownYear(data)
  const sunEls = track.map((point) => point.sun_el)
  const earthEls = track.map((point) => point.earth_el)
  const terrain = horizon.map((point) => point.el)
  const sunSwing = Math.max(...sunEls) - Math.min(...sunEls)
  const earthSwing = Math.max(...earthEls) - Math.min(...earthEls)
  const terrainSwing = Math.max(...terrain) - Math.min(...terrain)
  const least = extreme(year.months, (a, b) => a.pct_sun < b.pct_sun)
  const most = extreme(year.months, (a, b) => a.pct_sun > b.pct_sun)
  const ground = validation?.pgda.ours.find((row) => row.obs_height_m === 0)
  const raised = validation?.pgda.ours.find((row) => row.obs_height_m === summary.obs_height_m)
  const nearby = validation?.pgda.map?.sun_nearby_pct
  const panel = panelSunlight(track)

  return [
    {
      title: 'The Sun circles instead of climbing',
      text:
        `At the pole, the Sun goes around the horizon about once a month rather than rising overhead. ` +
        `In ${monthName(month)}, its elevation here changes by only ${sunSwing.toFixed(1)}°.`,
    },
    {
      title: 'So low hills decide everything',
      text:
        `The horizon around ${site.name} rises and falls by ${terrainSwing.toFixed(1)}°, while the ` +
        `Sun's elevation swings by ${sunSwing.toFixed(1)}°. With the Sun that low and no atmosphere ` +
        `to soften the edge, sunlight simply switches on and off as it passes behind each ridge.`,
    },
    {
      title: 'A few metres change the answer',
      text:
        (ground && raised
          ? `In our model, over 18.6 years, part of the Sun is visible ${pct(ground.sun_any_pct)} of the ` +
            `time from ground level and ${pct(raised.sun_any_pct)} from ${raised.obs_height_m} m up.`
          : `At polar ridges, raising a panel a few metres can add a lot of sunlight, because the Sun ` +
            `skims just over the terrain.`) +
        (nearby
          ? ` On NASA's map, pixels right next to this one range from ${nearby[0].toFixed(0)}% to ` +
            `${nearby[1].toFixed(0)}%.`
          : ''),
    },
    {
      title: 'Panels have to stand up',
      text:
        `With the Sun this low, a flat panel gets almost nothing: ${panel.flat.toFixed(0)} W/m² on ` +
        `average in ${monthName(month)}, against ${panel.vertical.toFixed(0)} W/m² for a vertical one ` +
        `that turns to face the Sun, before efficiency and losses.`,
    },
    {
      title: 'Dates matter as much as places',
      text:
        `The Moon's slight tilt gives the pole seasons. In ${year.name}, the Sun ` +
        `is up ${pct(least.pct_sun)} of ${monthName(least.month)} here, and ${pct(most.pct_sun)} of ` +
        `${monthName(most.month)}. A launch delay can move a mission into a very different month.`,
    },
    {
      title: 'Earth rises and sets too',
      text:
        `From most of the Moon's near side, Earth stays in about the same part of the sky. At the pole, ` +
        `that part of the sky is the horizon, and the Moon's wobble moves Earth through ${earthSwing.toFixed(1)}° of elevation ` +
        `in ${monthName(month)}. Direct contact can be lost for up to ` +
        `${formatDuration(year.stats.max_earth_gap_h)} at a stretch here in ${year.name}.`,
    },
  ]
}

function earthFact(data: ScenarioData): Fact {
  const { track, month } = data
  const earthEls = track.map((point) => point.earth_el)
  const { pct_earth: share, max_earth_gap_h: gap } = shownYear(data).stats
  if (share === 0) {
    return {
      title: 'Earth never rises here',
      text:
        `This site is on the far side, so there is no direct line to Earth at all. Everything ` +
        `has to go through a relay satellite.`,
    }
  }
  if (share === 100) {
    return {
      title: 'Earth never sets here',
      text:
        `The Moon keeps one face toward Earth, so Earth stays up all year here, between ` +
        `${Math.min(...earthEls).toFixed(0)}° and ${Math.max(...earthEls).toFixed(0)}° elevation in ` +
        `${monthName(month)}. Direct communication is available whenever the mission needs it.`,
    }
  }
  return {
    title: 'Earth comes and goes',
    text:
      `This site is close enough to the Moon's edge as seen from Earth that the Moon's wobble takes ` +
      `Earth below the horizon. It's up ${pct(share)} of the year, and contact can be lost for up to ` +
      `${formatDuration(gap)} at a stretch.`,
  }
}

/** Terrain this high, as a share of the Sun's peak, can decide whether there's sunlight. */
const TERRAIN_MATTERS_SHARE = 0.5

function regularFacts(data: ScenarioData): Fact[] {
  const { month, horizon, track, validation, summary } = data
  const year = shownYear(data).stats
  const peak = Math.max(...track.map((point) => point.sun_el))
  const highest = Math.max(...horizon.map((point) => point.el))
  // "Far below how high the Sun gets" is only true when terrain tops out well under the Sun.
  const terrainMatters = highest >= peak * TERRAIN_MATTERS_SHARE
  const ground = validation?.pgda.ours.find((row) => row.obs_height_m === 0)
  const raised = validation?.pgda.ours.find((row) => row.obs_height_m === summary.obs_height_m)
  return [
    {
      title: 'Long days and long nights',
      text:
        `The Sun rises and sets about once a month here. It's up ${pct(year.pct_sun)} of the ` +
        `year, and the longest stretch without it is ${formatDuration(year.max_sun_gap_h)}. ` +
        `Surviving that long, cold night is a major engineering problem.`,
    },
    {
      title: peak >= HIGH_SUN_DEG ? 'The Sun climbs high' : 'The Sun stays low',
      text:
        `In ${monthName(month)}, the Sun reaches ${peak.toFixed(0)}° here. Right at the pole, it stays ` +
        `within a few degrees of the horizon, which you can see by comparing with a south pole ridge.`,
    },
    {
      title: terrainMatters ? 'Terrain matters here too' : 'Terrain matters less',
      text: terrainMatters
        ? `The horizon here reaches ${highest.toFixed(1)}°, and the Sun only reaches ${peak.toFixed(1)}° this ` +
          `month, so hills can decide whether there's sunlight, much as they do at a polar ridge.`
        : `The horizon here reaches ${highest.toFixed(1)}°` +
          (ground && raised
            ? `, and raising a panel from the ground to ${raised.obs_height_m} m changes long-run ` +
              `sunlight only from ${pct(ground.sun_any_pct)} to ${pct(raised.sun_any_pct)} in our ` +
              `model. At a polar ridge, the same step makes a far bigger difference.`
            : `, far below how high the Sun gets. At a polar ridge, terrain often decides whether ` +
              `there's sunlight at all.`),
    },
    earthFact(data),
  ]
}

/** True where the Sun stays near the horizon, so low terrain decides what's lit. */
function isPolar(data: ScenarioData): boolean {
  const sunEls = data.track.map((point) => point.sun_el)
  return Math.max(...sunEls) - Math.min(...sunEls) < POLAR_SUN_SWING_DEG
}

export function explainerTitle(data: ScenarioData): string {
  if (!isPolar(data)) return `What conditions are like at ${data.site.name}`
  return `Why the lunar ${data.site.lat < 0 ? 'south' : 'north'} pole is so hard`
}

/** Facts for the selected site, in plain language. */
export function explainerFacts(data: ScenarioData): Fact[] {
  return isPolar(data) ? poleFacts(data) : regularFacts(data)
}

/** An elevation to a tenth of a degree, with a true minus sign: "−1.4°", "0.6°". */
function elevation(deg: number): string {
  const tenths = Math.round(deg * 10) / 10
  return `${tenths < 0 ? '−' : ''}${Math.abs(tenths).toFixed(1)}°`
}

/**
 * Why the site on show is hard, in three or four plain sentences built from that site's own
 * figures, for the Guide: how low the Sun stays, how long it is gone, how often Earth is hidden
 * and, at a pole, how much the month matters. Nothing here is general knowledge dressed as a
 * number: every figure is the pipeline's for this site, this month and this year.
 *
 * `mission`, when given, is the scenario on show: its length and the longest dark spell over it,
 * the same figure the verdict judges, so the Guide and the column say the same hours.
 */
export function whyHard(data: ScenarioData, mission?: { days: number; sunGapH: number | null } | null): string[] {
  const { site, month, track } = data
  const sunEls = track.map((point) => point.sun_el)
  const low = Math.min(...sunEls)
  const high = Math.max(...sunEls)
  const polar = isPolar(data)
  const sentences: string[] = [
    polar
      ? `At ${site.name} the Sun never climbs: in ${monthLong(month)} its elevation stays between ${elevation(low)} and ${elevation(high)} from level, so the skyline decides when there is sunlight.`
      : `At ${site.name} the Sun climbs to ${high.toFixed(0)}° in ${monthLong(month)}, so the trouble here is not a low Sun but how long it is gone.`,
  ]
  // The same hours the verdict judges, in the verdict's own words ("Sun down for N h").
  const onMission = mission && mission.sunGapH !== null ? `during your ${mission.days}-day mission from this landing the Sun is down for ${mission.sunGapH} h` : null
  const name = month.slice(0, 4)
  const stats = data.year.years.find((row) => String(row.year) === name)
  // Without the year's numbers (a year the data does not cover) only what the month and the mission say is said.
  if (!stats) return onMission ? [...sentences, `${onMission[0].toUpperCase()}${onMission.slice(1)}.`] : sentences

  const longest = stats.max_sun_gap_h === 0 ? `In ${name} the Sun is never wholly gone here` : `The longest stretch without the Sun here in ${name} is ${formatDuration(stats.max_sun_gap_h)}`
  sentences.push(onMission ? `${longest}; ${onMission}.` : `${longest}.`)

  sentences.push(
    stats.pct_earth === 0
      ? `Earth never rises here in ${name}, so every message needs a relay.`
      : stats.pct_earth === 100
        ? `Earth is in view all of ${name} here, so the terrain never blocks the radio.`
        : `Earth is hidden ${pct(100 - stats.pct_earth)} of ${name} here, for up to ${formatDuration(stats.max_earth_gap_h)} at a stretch.`,
  )

  // At a pole the month matters as much as the place: said only where the year's months really differ.
  const months = data.year.months.filter((row) => row.month.startsWith(name))
  if (polar && months.length > 1) {
    const least = extreme(months, (a, b) => a.pct_sun < b.pct_sun)
    const most = extreme(months, (a, b) => a.pct_sun > b.pct_sun)
    if (most.pct_sun - least.pct_sun >= 10) sentences.push(`The month matters too: the Sun is up ${pct(least.pct_sun)} of ${monthLong(least.month)} and ${pct(most.pct_sun)} of ${monthLong(most.month)}.`)
  }
  return sentences
}
