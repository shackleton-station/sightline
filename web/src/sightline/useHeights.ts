import { useEffect, useState } from 'react'
import { loadSiteFlagsAt } from '../data/heights'
import type { FlaggedSite } from '../data/useAllFlags'
import { DEFAULT_HEIGHTS, isBaseHeights, type MissionHeights } from '../lib/heights'
import type { YearSpan } from '../lib/span'

interface HeightFlags {
  /** Every listed site's flags, with the Sun seen from the panel's height and Earth from the antenna's. */
  flagged: FlaggedSite[]
  /** The heights those flags are for: the ones chosen once their files are in, the ones before until then. */
  applied: MissionHeights
  /** True while the chosen heights' files are on their way. */
  loading: boolean
  /** True if they could not be loaded: the screen stays on the heights it had. */
  failed: boolean
}

/**
 * The listed sites' flags at the mission's heights. At 2 m and 2 m these are the flags given,
 * untouched, and nothing is loaded. For another height its overview files are fetched (one small
 * file a year), and until they arrive the screen keeps the flags and the heights it had, so no
 * number is ever shown under the wrong height.
 */
export function useHeightFlags(flagged: FlaggedSite[], span: YearSpan, heights: MissionHeights): HeightFlags {
  const { panelM, antennaM } = heights
  const [held, setHeld] = useState<{ source: FlaggedSite[]; panelM: number; antennaM: number; flagged: FlaggedSite[] } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const key = `${panelM}/${antennaM}`
  const base = isBaseHeights(heights)

  useEffect(() => {
    if (base) return
    let current = true
    Promise.all(flagged.map(async ({ site }) => ({ site, flags: await loadSiteFlagsAt(site, span, { panelM, antennaM }) })))
      .then((mixed) => {
        if (!current) return
        setHeld({ source: flagged, panelM, antennaM, flagged: mixed })
        setFailed(null)
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setFailed(key)
      })
    return () => {
      current = false
    }
    // The span's years, not the object: a caller may make a new one on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [flagged, span.from, span.to, panelM, antennaM, base, key])

  if (base) return { flagged, applied: heights, loading: false, failed: false }
  // What is in hand for these sites and years: the chosen heights' flags, or those of the heights before.
  const inHand = held && held.source === flagged ? held : null
  if (inHand && inHand.panelM === panelM && inHand.antennaM === antennaM) return { flagged: inHand.flagged, applied: heights, loading: false, failed: false }
  const waiting = failed !== key
  return inHand ? { flagged: inHand.flagged, applied: { panelM: inHand.panelM, antennaM: inHand.antennaM }, loading: waiting, failed: !waiting } : { flagged, applied: DEFAULT_HEIGHTS, loading: waiting, failed: !waiting }
}
