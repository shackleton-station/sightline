import type { SiteInfo } from '../data/contract'
import { customSiteInfo, isCustomSite } from '../data/customSite'
import type { FutureTarget } from '../data/futureTargets'
import { parseCustomSite } from '../lib/urlState'

/**
 * The site a scenario names: a listed one by its id, or a custom point from "lat,lon". Null if it
 * names neither. A point that is one of the future targets takes the target's name, marked
 * approximate: it is worked out like any custom point.
 */
export function siteFor(sites: SiteInfo[], value: string, targets: FutureTarget[] = []): SiteInfo | null {
  const point = parseCustomSite(value)
  if (point) {
    const custom = customSiteInfo(point.lat, point.lon)
    const target = targetAt(targets, custom)
    return target ? { ...custom, name: `${target.name} (approximate)`, source_url: target.source_url } : custom
  }
  return sites.find((site) => site.id === value) ?? null
}

/** How a scenario names a future target: as the custom point at the centre of its feature. */
export function targetValue(target: FutureTarget): string {
  return siteValue(customSiteInfo(target.lat, target.lon))
}

/** The future target a site is, if it is one. */
export function targetAt(targets: FutureTarget[], site: SiteInfo): FutureTarget | null {
  if (!isCustomSite(site)) return null
  return targets.find((target) => targetValue(target) === siteValue(site)) ?? null
}

/** How a scenario, and so a link, names a site. */
export function siteValue(site: SiteInfo): string {
  return isCustomSite(site) ? `${site.lat},${site.lon}` : site.id
}
