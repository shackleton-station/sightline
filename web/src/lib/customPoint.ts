import type { SiteInfo } from '../data/contract'

/** The group every custom point belongs to: it has no listed neighbours. */
export const CUSTOM_GROUP = 'Custom'

/**
 * A site for typed coordinates. It has no browser code in it, so the page and the co-pilot's tools
 * name and round a custom point the same way.
 */
export function customSiteInfo(rawLat: number, rawLon: number): SiteInfo {
  // About 3 cm on the ground. Also keeps numbers out of exponent form, which a link couldn't carry.
  const lat = Number(rawLat.toFixed(6))
  const lon = Number(rawLon.toFixed(6))
  const latText = `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}`
  const lonText = `${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`
  return {
    id: `custom:${lat},${lon}`,
    name: `Custom point ${latText}, ${lonText}`,
    lat,
    lon,
    source_url: '',
    group: CUSTOM_GROUP,
  }
}

export function isCustomSite(site: SiteInfo): boolean {
  return site.group === CUSTOM_GROUP
}
