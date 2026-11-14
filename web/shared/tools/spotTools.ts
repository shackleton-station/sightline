import { rangeWords } from '../../src/lib/lightGrid'
import { formatDuration } from '../../src/lib/nextChange'
import { distanceKm } from '../../src/lib/slip'
import { type Args, type ToolContext, ToolError } from './args'
import { fact, latitudeLabel, longitudeLabel, monthWords, type ToolResult } from './facts'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** "2.4 km", or "36 km" from ten up. */
export function kmLabel(km: number): string {
  return `${km.toFixed(km < 10 ? 1 : 0)} km`
}

/**
 * The spot the visitor tapped on the Atlas map, for one month: its Sun and Earth, from the light
 * grid. The place comes from the visitor's own view, never from the model.
 */
export async function spotLight(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const place = ctx.spot
  if (!place) throw new ToolError('The visitor has not tapped a spot on the Atlas map. Only the listed sites can be looked up.')
  if (typeof args.month !== 'string' || !MONTH.test(args.month)) throw new ToolError('Give the month as YYYY-MM.')
  const found = await ctx.data.light.spot(place.lat, place.lon, args.month)
  if (!found.ok) {
    if (found.why === 'outside') throw new ToolError('That spot is outside the ground the light is worked out for, which is a square around the south pole. Offer the nearest listed site instead.')
    if (found.why === 'no-month') throw new ToolError(`The light grid has no ${args.month}. It covers the same months as the listed sites.`)
    throw new ToolError('The light grid is not available right now. Offer the nearest listed site instead.')
  }
  const { meta, spot } = found
  const pct = (value: number) => `${Math.round(value)}%`
  const nearest = (await ctx.data.sites()).map((site) => ({ site, km: distanceKm(place, site) })).sort((a, b) => a.km - b.km)[0]
  return {
    ok: true,
    title: `Tapped spot, ${monthWords(args.month)}: light grid`,
    facts: [
      fact('latitude', 'Latitude of the tapped spot', latitudeLabel(place.lat)),
      fact('longitude', 'Longitude of the tapped spot', longitudeLabel(place.lon)),
      fact('month', 'Month', monthWords(args.month)),
      fact('pct_sun', 'Share of the month with the Sun in view at this spot', pct(spot.numbers.pctSun)),
      fact('pct_sun_nearby', `The same share across this pixel and the eight around it (within ${meta.pixel_m} m), lowest to highest`, rangeWords(spot.nearby.pctSun)),
      fact('pct_earth', 'Share of the month with Earth in view at this spot', pct(spot.numbers.pctEarth)),
      fact('pct_earth_nearby', `The same share across this pixel and the eight around it (within ${meta.pixel_m} m), lowest to highest`, rangeWords(spot.nearby.pctEarth)),
      fact('pct_both', 'Share of the month with the Sun and Earth both in view', pct(spot.numbers.pctBoth)),
      fact('longest_without_sun', 'Longest stretch without the Sun in the month', formatDuration(spot.numbers.sunGapH)),
      fact('longest_without_earth', 'Longest stretch without Earth in the month', formatDuration(spot.numbers.earthGapH)),
      fact('resolution', 'What this describes', `one ${meta.pixel_m} m pixel of the map, ${meta.obs_height_m} m above the ground`),
      fact('nearest_site', 'Nearest listed site', nearest.site.name),
      fact('nearest_distance', 'Its distance from the tapped spot', kmLabel(nearest.km)),
    ],
  }
}
