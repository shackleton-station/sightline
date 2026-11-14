import { useEffect, useState } from 'react'
import type { SiteFlags } from '../lib/flags'
import type { SiteInfo } from './contract'
import { loadSiteFlags } from './loadSite'

export interface FlaggedSite {
  site: SiteInfo
  flags: SiteFlags
}

/** Flags for every site given, over the page's years; null until all have loaded. */
export function useAllFlags(sites: SiteInfo[]): FlaggedSite[] | null {
  const [all, setAll] = useState<{ sites: SiteInfo[]; value: FlaggedSite[] } | null>(null)

  useEffect(() => {
    let current = true
    Promise.all(sites.map(async (site) => ({ site, flags: await loadSiteFlags(site) })))
      .then((value) => {
        if (current) setAll({ sites, value })
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [sites])

  return all?.sites === sites ? all.value : null
}
