import { useEffect, useState } from 'react'
import type { Validation } from './contract'
import { loadValidation } from './loadSite'

/**
 * The validation files of the listed sites asked for, by site id: undefined until a file has
 * arrived, null if it could not be read. Each is fetched once and kept; a custom point (null in the
 * list) has none.
 */
export function useSiteValidations(siteIds: (string | null)[]): Record<string, Validation | null | undefined> {
  const [loaded, setLoaded] = useState<Record<string, Validation | null>>({})
  const key = [...new Set(siteIds.filter((id): id is string => id !== null))].sort().join('|')
  useEffect(() => {
    let cancelled = false
    for (const id of key === '' ? [] : key.split('|')) {
      loadValidation(id).then(
        (validation) => {
          if (!cancelled) setLoaded((before) => (before[id] === validation ? before : { ...before, [id]: validation }))
        },
        () => {
          // A file that cannot be read is not worth losing the page over: the rows it would settle show no star.
          if (!cancelled) setLoaded((before) => (id in before ? before : { ...before, [id]: null }))
        },
      )
    }
    return () => {
      cancelled = true
    }
  }, [key])
  return loaded
}
