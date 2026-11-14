import { useEffect, useState } from 'react'
import type { DataRange } from './contract'
import { loadRange } from './loadSite'

/** What span of time the data covers, from the pipeline's own description; null until it has loaded. */
export function useRange(): DataRange | null {
  const [range, setRange] = useState<DataRange | null>(null)
  useEffect(() => {
    let current = true
    loadRange()
      .then((described) => {
        if (current) setRange(described)
      })
      // The page says less without it; it never guesses the years.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [])
  return range
}
