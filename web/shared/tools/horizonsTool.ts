import type { SiteInfo } from '../../src/data/contract'
import { withinWords } from '../../src/lib/horizonsLink'
import { hourOf, locateHour } from '../../src/lib/mission'
import { pct } from '../../src/lib/verdict'
import { type Args, siteArg, timeArg, type ToolContext, ToolError } from './args'
import { fact, type Fact, type ToolResult, whenLabel } from './facts'

/** Where NASA JPL Horizons puts the Sun and Earth in a site's sky at one hour. Azimuth from north, clockwise; elevation from a level horizon. */
export interface HorizonsNumbers {
  sun: { azDeg: number; elDeg: number }
  earth: { azDeg: number; elDeg: number }
  /** The ephemeris Horizons said it used. */
  ephemeris: string | null
  /** The site's height given to Horizons, km above the Moon's reference sphere. */
  altKm: number
}

/** Asks Horizons about one listed site at one whole hour. 'busy' when too many have been asked lately; null when it did not answer. */
export type HorizonsAsk = (site: SiteInfo, hourIso: string) => Promise<HorizonsNumbers | 'busy' | null>

/** Two decimals, as the app's own angles are stored: "−1.77°". */
function deg2(deg: number): string {
  const rounded = Math.round(deg * 100) / 100
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(2)}°`
}

/** The difference between two azimuths, the short way round, in degrees. */
export function azimuthGapDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/**
 * "Check this with Horizons": NASA JPL's own answer for one listed site at one hour, asked live, set
 * beside the app's. The pipeline has already compared every hour (horizons.json); this lets a
 * visitor see one hour's two answers side by side.
 */
export async function horizonsCheck(args: Args, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.horizons) throw new ToolError('Horizons cannot be asked from here. Say that every hour was already compared with Horizons, and that How it works has the result.')
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const iso = timeArg(args.time, flags)
  const place = locateHour(flags.start, hourOf(flags.start, iso))
  const month = await ctx.data.scenario(site.id, place.month)
  const ours = month.track[place.index]

  const nasa = await ctx.horizons(site, iso)
  if (nasa === 'busy') throw new ToolError('Horizons has been asked too often in the last while. Say so, and that How it works has the comparison already made for every hour.')
  if (!nasa) throw new ToolError('Horizons did not answer. Say so, and that How it works has the comparison already made for every hour.')

  const gaps = [
    Math.abs(nasa.sun.elDeg - ours.sun_el),
    Math.abs(nasa.earth.elDeg - ours.earth_el),
    azimuthGapDeg(nasa.sun.azDeg, ours.sun_az),
    azimuthGapDeg(nasa.earth.azDeg, ours.earth_az),
  ]
  const largest = Math.max(...gaps)
  return {
    ok: true,
    title: `${site.name}, ${whenLabel(iso)}: NASA JPL Horizons beside this app`,
    facts: [
      fact('site', 'Site', site.name),
      fact('time', 'Time', whenLabel(iso)),
      fact('sun_elevation_nasa', "Sun elevation (from a level horizon), NASA JPL Horizons' answer", deg2(nasa.sun.elDeg)),
      fact('sun_elevation_ours', "Sun elevation (from a level horizon), this app's answer", deg2(ours.sun_el)),
      fact('sun_azimuth_nasa', "Sun azimuth (from north, clockwise), NASA JPL Horizons' answer", deg2(nasa.sun.azDeg)),
      fact('sun_azimuth_ours', "Sun azimuth (from north, clockwise), this app's answer", deg2(ours.sun_az)),
      fact('earth_elevation_nasa', "Earth elevation (from a level horizon), NASA JPL Horizons' answer", deg2(nasa.earth.elDeg)),
      fact('earth_elevation_ours', "Earth elevation (from a level horizon), this app's answer", deg2(ours.earth_el)),
      fact('earth_azimuth_nasa', "Earth azimuth (from north, clockwise), NASA JPL Horizons' answer", deg2(nasa.earth.azDeg)),
      fact('earth_azimuth_ours', "Earth azimuth (from north, clockwise), this app's answer", deg2(ours.earth_az)),
      fact('agreement', 'How closely the two answers agree across these four angles', `within ${withinWords(largest)}`),
      fact('ephemeris', 'Ephemeris Horizons used', nasa.ephemeris ?? 'not stated'),
      fact('height', "Site height given to Horizons, above the Moon's reference sphere", `${nasa.altKm.toFixed(3)} km`),
      fact('what_it_is', 'What this compares', 'the direction of each body from the site, before the terrain is taken into account; Horizons knows nothing of the skyline'),
      ...(await storedChecks(ctx, site, month.validation)),
    ],
  }
}

/**
 * The two checks already made ahead of time, which the visitor's screen cites: every hour of the
 * data compared with Horizons for this site, and the long-run averages compared with NASA's own
 * illumination maps (NASA GSFC PGDA), which exist for the ground near the poles.
 */
async function storedChecks(ctx: ToolContext, site: SiteInfo, validation: { pgda?: { span: { start: string; end: string }; map: { sun_pct: number; earth_pct: number } | null; ours: { obs_height_m: number; sun_any_pct: number; earth_any_pct: number }[] } } | null): Promise<Fact[]> {
  const facts: Fact[] = []
  const everyHour = await ctx.data.everyHourCheck(site.id).catch(() => null)
  if (everyHour) {
    facts.push(fact('every_hour_count', 'Hours already compared with Horizons for this site, one by one, over the whole span of the data', `${everyHour.hours.toLocaleString('en-US')} hours`))
    facts.push(fact('every_hour_agreement', 'How closely this app agrees with Horizons over all those hours, as a complete phrase', `within ${withinWords(everyHour.maxDeg)}`))
  }
  const pgda = validation?.pgda
  const ground = pgda?.ours.find((row) => row.obs_height_m === 0)
  if (pgda?.map && ground) {
    const years = `${pgda.span.start.slice(0, 4)} to ${pgda.span.end.slice(0, 4)}`
    facts.push(fact('nasa_map_years', "Years the comparison with NASA's long-run illumination maps covers", years))
    facts.push(fact('nasa_map_sun', "Share of time with the Sun in view at this site in NASA's long-run illumination map (measured at the ground)", pct(pgda.map.sun_pct)))
    facts.push(fact('ours_sun_at_ground', "The same share from this app's own model at the ground, over the same years", pct(ground.sun_any_pct)))
    facts.push(fact('nasa_map_earth', "Share of time with Earth in view at this site in NASA's long-run map", pct(pgda.map.earth_pct)))
    facts.push(fact('ours_earth_at_ground', "The same share from this app's own model at the ground, over the same years", pct(ground.earth_any_pct)))
  } else {
    facts.push(fact('nasa_map', "The comparison with NASA's long-run illumination maps", 'those maps cover the ground near the poles only, and this site is outside them'))
  }
  return facts
}

