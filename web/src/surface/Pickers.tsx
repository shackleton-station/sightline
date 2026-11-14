import { useMemo } from 'react'
import type { SiteInfo } from '../data/contract'
import { monthLabel } from '../lib/months'

interface Props {
  sites: SiteInfo[]
  siteId: string
  month: string
  months: string[]
  onSite: (siteId: string) => void
  onMonth: (month: string) => void
}

/** Where to stand and which month to watch: the listed sites, in their groups, and every month in the data. */
export function Pickers({ sites, siteId, month, months, onSite, onMonth }: Props) {
  const groups = useMemo(() => [...new Set(sites.map((site) => site.group))], [sites])
  return (
    <div className="sf-where">
      <select aria-label="Landing site" value={siteId} onChange={(event) => onSite(event.target.value)}>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {sites
              .filter((site) => site.group === group)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <select aria-label="Month" value={month} onChange={(event) => onMonth(event.target.value)}>
        {months.map((option) => (
          <option key={option} value={option}>
            {monthLabel(option)}
          </option>
        ))}
      </select>
    </div>
  )
}
