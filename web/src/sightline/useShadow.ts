import { useEffect, useState } from 'react'
import type { ShadowDistances } from '../data/contract'

let shadowRequest: Promise<ShadowDistances> | null = null

/** Each listed site's distance to permanent shadow: a small file, fetched when Compare first opens (`wanted`). */
export function useShadow(wanted: boolean): ShadowDistances | null {
  const [shadow, setShadow] = useState<ShadowDistances | null>(null)
  useEffect(() => {
    if (!wanted) return
    let current = true
    shadowRequest ??= fetch(`${import.meta.env.BASE_URL}data/shadow.json`).then((response) => {
      if (!response.ok) throw new Error(`shadow.json: HTTP ${response.status}`)
      return response.json() as Promise<ShadowDistances>
    })
    shadowRequest
      .then((loaded) => {
        if (current) setShadow(loaded)
      })
      // The science rows stay empty; every other row is unaffected.
      .catch((reason: unknown) => {
        shadowRequest = null
        console.error(reason)
      })
    return () => {
      current = false
    }
  }, [wanted])
  return shadow
}
