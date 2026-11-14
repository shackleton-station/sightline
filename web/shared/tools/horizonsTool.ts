import type { SiteInfo } from '../../src/data/contract'
import { hourOf, locateHour } from '../../src/lib/mission'
import { type Args, siteArg, timeArg, type ToolContext, ToolError } from './args'
import { fact, type ToolResult, whenLabel } from './facts'

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
  const ours = (await ctx.data.scenario(site.id, place.month)).track[place.index]

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
      fact('largest_difference', 'Largest difference between the two answers across these four angles', largest < 0.005 ? 'under 0.01°' : deg2(largest)),
      fact('ephemeris', 'Ephemeris Horizons used', nasa.ephemeris ?? 'not stated'),
      fact('height', "Site height given to Horizons, above the Moon's reference sphere", `${nasa.altKm.toFixed(3)} km`),
      fact('what_it_is', 'What this compares', 'the direction of each body from the site, before the terrain is taken into account; Horizons knows nothing of the skyline'),
    ],
  }
}
