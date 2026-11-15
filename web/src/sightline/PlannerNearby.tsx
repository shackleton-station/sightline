import { useEffect, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { loadSpread, loadSummary } from '../data/loadSite'
import { NearbyMap } from '../components/NearbyMap'
import { monthLabel } from '../lib/months'
import { spreadSentence } from '../lib/spread'

interface Props {
  site: SiteInfo
  month: string
  /** A spot on the map chosen: add it as a scenario, as the month's own "Add" does. */
  onSpot: (lat: number, lon: number) => void
}

/**
 * Why a small change of place matters, for the month opened under Find's grid: how much the same
 * month changes within the landing's own accuracy (the site's spread, 100 m), and, a click away, the
 * map of the ground around the site with better places to look. Only the ridge sites have this
 * ground worked out; elsewhere it says nothing.
 */
export function PlannerNearby({ site, month, onSpot }: Props) {
  const [spread, setSpread] = useState<{ key: string; text: string | null } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const key = `${site.id}@${month}`
  useEffect(() => {
    if (!site.nearby_half_m) return
    let current = true
    Promise.all([loadSpread(site), loadSummary(site, month)])
      .then(([loaded, summary]) => current && setSpread({ key, text: loaded ? spreadSentence(loaded, month, summary) : null }))
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setSpread({ key, text: null })
      })
    return () => {
      current = false
    }
  }, [site, month, key])

  if (!site.nearby_half_m) return null
  const text = spread?.key === key ? spread.text : undefined
  return (
    <section className="pl-nearby" aria-label={`The ground around ${site.name}`}>
      <h5>A few meters make a difference</h5>
      <p>{text === undefined ? 'Reading how much this month changes close by…' : (text ?? `How much ${monthLabel(month)} changes close by isn't worked out here.`)}</p>
      <button type="button" className="sl-small" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>
        {mapOpen ? 'Hide the ground around it' : `Show the ground around ${site.name}`}
      </button>
      {mapOpen && (
        <div className="pl-nearby-map">
          <NearbyMap anchor={site} point={site} month={month} mode="plan" onOpen={onSpot} />
        </div>
      )}
    </section>
  )
}
