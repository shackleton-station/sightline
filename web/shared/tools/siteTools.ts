import { answerAt } from '../../src/lib/answer'
import { peakSunElevation } from '../../src/lib/compare'
import { gridRow, metricFlags, monthSpans } from '../../src/lib/grid'
import { horizonAt } from '../../src/lib/customModel'
import { hourOf, locateHour, longestDown, missionEarth } from '../../src/lib/mission'
import { formatDuration } from '../../src/lib/nextChange'
import { panelSunlight } from '../../src/lib/power'
import { alternativesAt, conditionsAt } from '../../src/lib/slip'
import { degWords } from '../../src/lib/sightline'
import { pct } from '../../src/lib/verdict'
import { type Args, lastYear, limitsArg, monthArg, siteArg, timeArg, type ToolContext, ToolError } from './args'
import { daysLabel, fact, type Fact, isoAt, latitudeLabel, limitFacts, limitsLabel, longitudeLabel, monthWords, type ToolResult, whenLabel } from './facts'
import { nextLandingOnScreen } from './nextLanding'

/** From the Moon, Earth's disc is never smaller than this across its radius (it is 0.90° to 1.02° with its distance). */
const EARTH_RADIUS_AT_LEAST_DEG = 0.9

/** Where a site is and what the data covers. */
export async function siteInfo(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const facts = [
    fact('site', 'Site', site.name),
    fact('group', 'Group', site.group),
    fact('latitude', 'Latitude', latitudeLabel(site.lat)),
    fact('longitude', 'Longitude', longitudeLabel(site.lon)),
    fact('data_from', 'Data starts', monthWords(flags.start.slice(0, 7))),
    fact('data_to', 'Data ends', monthWords(isoAt(flags.start, flags.sun.length - 1).slice(0, 7))),
  ]
  if (site.slope) {
    facts.push(fact('slope', 'Ground slope', `${site.slope.deg.toFixed(1)}° over ${site.slope.baseline_m} m`))
  }
  return { ok: true, title: `${site.name}: about the site`, facts }
}

/** One hour at one site: what is up, what changes next, and whether a landing then meets the limits. */
export async function conditionsAtTime(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const iso = timeArg(args.time, flags)
  const requirements = limitsArg(ctx, args)
  const conditions = conditionsAt(flags, iso, requirements)
  if (!conditions) throw new ToolError('That time is outside the data.')

  const place = locateHour(flags.start, hourOf(flags.start, iso))
  const month = await ctx.data.scenario(site.id, place.month)
  const now = month.track[place.index]
  const answer = answerAt(now, flags, lastYear(flags))
  // Two angles, with the app's two names. "Above the skyline" is measured from the terrain's outline in
  // the body's direction and decides whether it is in view; "elevation" is measured from a level horizon.
  const aboveSkyline = (elDeg: number, azDeg: number) => degWords(elDeg - horizonAt(month.horizon, azDeg))
  // Earth is treated as the Sun is: when the skyline hides part of its disc it is "partly in view".
  // Its centre lower above the skyline than its radius means part is hidden; below the skyline, only an edge shows.
  const earthAbove = now.earth_el - horizonAt(month.horizon, now.earth_az)
  const earthPartly = conditions.earthUp && earthAbove < EARTH_RADIUS_AT_LEAST_DEG
  const earthWords = !conditions.earthUp
    ? 'out of view'
    : earthAbove < 0
      ? 'partly in view: only its upper edge shows over the skyline, so a radio link there is marginal'
      : earthPartly
        ? 'partly in view: the skyline hides part of its disc'
        : 'in view'
  const facts = [
    fact('site', 'Site', site.name),
    fact('time', 'Time', whenLabel(iso)),
    fact('headline', 'In short', earthPartly ? answer.headline.replace('Earth is in view', 'Earth is partly in view') : answer.headline),
    fact('sun', 'Sun', conditions.sunUp ? 'up' : 'down'),
    fact('earth', 'Earth', earthWords),
    ...nextChange('sun', 'the Sun', conditions.sunUp ? 'sunset' : 'sunrise', answer.sun.hours, lastYear(flags)),
    ...nextChange('earth', 'Earth', conditions.earthUp ? 'earthset' : 'earthrise', answer.earth.hours, lastYear(flags)),
    fact('sun_above_skyline', "Sun above the skyline (its centre above the terrain's outline in its direction, seen from the site; this decides whether it is in view)", aboveSkyline(now.sun_el, now.sun_az)),
    fact('earth_above_skyline', "Earth above the skyline (its centre above the terrain's outline in its direction, seen from the site; this decides whether it is in view)", aboveSkyline(now.earth_el, now.earth_az)),
    fact('sun_height', 'Sun elevation (from a level horizon)', degWords(now.sun_el)),
    fact('earth_height', 'Earth elevation (from a level horizon)', degWords(now.earth_el)),
    fact('limits', 'Checked against', limitsLabel(requirements)),
    ...limitFacts(requirements),
    fact('landing', 'A landing at this hour', conditions.problems.length === 0 ? 'meets the limits' : 'does not meet the limits'),
    ...missionGaps(flags, hourOf(flags.start, iso), requirements),
  ]
  conditions.problems.forEach((problem, i) => facts.push(fact(`problem_${i + 1}`, 'Why it does not meet the limits', problem.replace(/\.$/, '').replace(/^The /, 'the '))))

  if (conditions.problems.length > 0) {
    // The hour the visitor's screen offers as "Next landing that fits", by the same rule.
    const next = await nextLandingOnScreen(ctx.data, site.id, flags, iso, requirements)
    if (next) {
      facts.push(fact('next_landing', 'Next landing that fits here, as the visitor\'s screen offers it', whenLabel(next.t)))
      facts.push(fact('next_landing_wait', 'Wait until then', formatDuration(next.waitH)))
    } else {
      facts.push(fact('next_landing', 'Next landing that fits here', 'none in the data'))
    }
    const others = alternativesAt(site, iso, await ctx.data.allFlags(), requirements, 3)
    others.forEach((other, i) => {
      facts.push(fact(`other_${i + 1}_site`, 'A listed site that meets the limits at this hour', other.site.name))
      facts.push(fact(`other_${i + 1}_distance`, 'Its distance from this site', `${other.distanceKm.toFixed(0)} km`))
    })
  }
  return { ok: true, title: `${site.name}, ${whenLabel(iso)}`, facts }
}

/**
 * The next change for a body as two facts, so each drops into a sentence: what happens ("sunset")
 * and how long until it ("5 d 11 h"). Where the data holds no such change there is one fact, a
 * whole phrase ("no sunset through 2049").
 */
function nextChange(key: string, body: string, event: string, hours: number | null, last: number): Fact[] {
  if (hours === null) return [fact(`${key}_next_change`, `Next change for ${body}, as a complete phrase`, `no ${event} through ${last}`)]
  return [
    fact(`${key}_next_change`, `Next change for ${body}`, event),
    fact(`${key}_next_change_in`, `Time until that ${event}`, formatDuration(hours)),
  ]
}

/**
 * The longest time without the Sun and without Earth over a mission that lands at this hour: the
 * figures the visitor's screen shows beside the Sun's and Earth's rows ("95 h dark", "169 h radio
 * silence"), given whether or not a limit is broken. Nothing when the mission runs past the data.
 */
function missionGaps(flags: Parameters<typeof missionEarth>[0], hour: number, requirements: Parameters<typeof missionEarth>[1]): Fact[] {
  const end = hour + requirements.missionDays * 24
  if (hour < 0 || end > flags.sun.length) return []
  return [
    fact('mission_longest_without_sun', 'Longest time without the Sun during a mission that lands at this hour', `${longestDown(flags.sun, hour, end)} h`),
    fact('mission_longest_without_earth', 'Longest time without Earth (radio silence) during a mission that lands at this hour', `${longestDown(missionEarth(flags, requirements), hour, end)} h`),
  ]
}

/** One month at one site. */
export async function monthSummary(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const month = monthArg(args.month, flags)
  const requirements = limitsArg(ctx, args)
  const data = await ctx.data.scenario(site.id, month)
  const { summary } = data
  const sunlight = panelSunlight(data.track)

  const span = monthSpans(flags.start, flags.sun.length).find((candidate) => candidate.month === month)
  if (!span) throw new ToolError(`No data for ${month}.`)
  const [landing] = gridRow(metricFlags('landing', flags, requirements), [span], 'landing')
  const daysInMonth = (span.to - span.from) / 24

  const facts = [
    fact('site', 'Site', site.name),
    fact('month', 'Month', monthWords(month)),
    fact('pct_sun', 'Sun up', pct(summary.pct_sun)),
    fact('pct_earth', 'Earth in view', pct(summary.pct_earth)),
    fact('pct_both', 'Both at once', pct(summary.pct_both)),
    fact('longest_without_sun', 'Longest stretch without the Sun', formatDuration(summary.max_sun_gap_h)),
    fact('longest_without_earth', 'Longest stretch without Earth', formatDuration(summary.max_earth_gap_h)),
    fact('highest_sun', 'Highest elevation the Sun\'s center reaches this month, from a level horizon (minus means below level)', degWords(peakSunElevation(data))),
    fact('sun_elevation_range', 'The Sun\'s elevation over the month, from a level horizon, as a complete phrase', `between ${degWords(Math.min(...data.track.map((point) => point.sun_el)))} and ${degWords(Math.max(...data.track.map((point) => point.sun_el)))} from level`),
    fact('panel_vertical', 'Average sunlight on a Sun-facing vertical panel', `${sunlight.vertical.toFixed(0)} W/m²`),
    fact('panel_flat', 'Average sunlight on a flat panel', `${sunlight.flat.toFixed(0)} W/m²`),
    fact('limits', 'Landing days are checked against', limitsLabel(requirements)),
    fact('landing_days', 'Days with an hour that meets the limits', `${landing.days} of ${daysLabel(daysInMonth)}`),
  ]
  if (landing.days > 0) {
    facts.push(fact('first_landing', 'First hour that meets the limits', whenLabel(isoAt(flags.start, landing.firstHour))))
  }
  return { ok: true, title: `${site.name}, ${monthWords(month)}: month summary`, facts }
}

/** One calendar year at one site. */
export async function yearSummary(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const { years } = await ctx.data.year(site.id)
  const stats = years.find((row) => row.year === args.year)
  if (!stats) throw new ToolError(`No data for that year. Years: ${years.map((row) => row.year).join(', ')}.`)
  return {
    ok: true,
    title: `${site.name}, ${stats.year}: year summary`,
    facts: [
      fact('site', 'Site', site.name),
      fact('year', 'Year', String(stats.year)),
      fact('pct_sun', 'Sun up', pct(stats.pct_sun)),
      fact('pct_earth', 'Earth in view', pct(stats.pct_earth)),
      fact('pct_both', 'Both at once', pct(stats.pct_both)),
      fact('longest_without_sun', 'Longest stretch without the Sun', formatDuration(stats.max_sun_gap_h)),
      fact('longest_without_earth', 'Longest stretch without Earth', formatDuration(stats.max_earth_gap_h)),
    ],
  }
}
