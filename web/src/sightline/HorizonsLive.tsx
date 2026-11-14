import { useState } from 'react'
import { checkWithHorizons, degreesWords, type HorizonsLive as Live } from '../lib/horizonsLive'

interface Props {
  lat: number
  lon: number
  /** The hour on show, a whole hour in UTC. */
  hour: string
  /** This page's own elevations of the Sun and Earth for that hour, in degrees. */
  ours: { sunEl: number; earthEl: number }
}

/**
 * For a point that was never compared ahead of time (a custom point): one link that asks NASA JPL
 * Horizons, through the site's server, where the Sun and Earth stand there at the hour on show, and
 * puts NASA's two elevations beside the page's own. Quiet when Horizons can't be reached.
 */
export function HorizonsLive({ lat, lon, hour, ours }: Props) {
  const [state, setState] = useState<{ key: string; answer: Live | null | 'asking' } | null>(null)
  const key = `${lat},${lon},${hour}`
  const mine = state?.key === key ? state.answer : undefined

  if (mine === undefined) {
    return (
      <button
        type="button"
        className="sl-link"
        title="Asks NASA JPL's Horizons service for the Sun's and Earth's elevation at this point and hour, and shows its answer beside this page's"
        onClick={() => {
          setState({ key, answer: 'asking' })
          void checkWithHorizons(lat, lon, hour).then((answer) => setState((last) => (last?.key === key ? { key, answer } : last)))
        }}
      >
        Check with Horizons
      </button>
    )
  }
  if (mine === 'asking') return <span role="status">Asking Horizons…</span>
  if (mine === null) return <span role="status">Horizons did not answer.</span>
  return (
    <span
      role="status"
      title={`NASA JPL Horizons${mine.ephemeris ? ` (${mine.ephemeris})` : ''}, asked just now: the Sun's and Earth's elevation above a level horizon at this point and hour (azimuths ${mine.sun.azDeg.toFixed(2)}° and ${mine.earth.azDeg.toFixed(2)}°), then this page's own. Horizons was asked at the height of the Moon's reference sphere, not the ground's own.`}
    >
      Horizons: Sun {degreesWords(mine.sun.elDeg)}, Earth {degreesWords(mine.earth.elDeg)} · ours {degreesWords(ours.sunEl)}, {degreesWords(ours.earthEl)}
    </span>
  )
}
