import { useEffect, useState } from 'react'
import type { SiteFlags } from '../lib/flags'
import type { SiteInfo } from './contract'
import { loadSiteFlags } from './loadSite'

export interface SiteFlagsState {
  flags: SiteFlags | null
  /** True if they couldn't load, so "still loading" isn't shown forever. */
  failed: boolean
}

/** Hourly Sun and Earth flags for a site across all the data, and whether they failed to load. */
export function useSiteFlagsState(site: SiteInfo | null): SiteFlagsState {
  const [loaded, setLoaded] = useState<{ siteId: string; value: SiteFlags | null } | null>(null)

  useEffect(() => {
    if (!site) return
    let current = true
    loadSiteFlags(site)
      .then((value) => {
        if (current) setLoaded({ siteId: site.id, value })
      })
      // The month's own numbers still show; only the checks across dates wait for these.
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setLoaded({ siteId: site.id, value: null })
      })
    return () => {
      current = false
    }
  }, [site])

  const known = site !== null && loaded?.siteId === site.id
  return { flags: known ? loaded.value : null, failed: known && loaded.value === null }
}

/** Hourly Sun and Earth flags for a site across all the data; null until they've loaded. */
export function useSiteFlags(site: SiteInfo | null): SiteFlags | null {
  return useSiteFlagsState(site).flags
}
