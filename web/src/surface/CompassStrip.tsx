import { compassPoint, turnBetween, wrap360 } from '../lib/surfaceView'

interface Mark {
  azDeg: number
  /** The track's answer: is any part of it above the horizon? */
  up: boolean
}

interface Props {
  headingDeg: number
  /** How many degrees the picture spans from its left edge to its right. */
  acrossDeg: number
  sun: Mark
  earth: Mark
}

const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
const TICKS = Array.from({ length: 36 }, (_, i) => i * 10)

/** "12° to your left", for the strip's description. */
function turnWords(headingDeg: number, azDeg: number): string {
  const turn = Math.round(turnBetween(headingDeg, azDeg))
  if (Math.abs(turn) < 2) return 'straight ahead'
  if (Math.abs(turn) > 150) return 'behind you'
  return `${Math.abs(turn)}° to your ${turn < 0 ? 'left' : 'right'}`
}

/**
 * Which way the visitor faces: a strip of the whole compass, with the middle of it the middle of
 * the picture. The Sun and Earth sit on it at their azimuths from the track (filled when up, hollow
 * when the land hides them), so turning toward a mark brings that body into view.
 */
export function CompassStrip({ headingDeg, acrossDeg, sun, earth }: Props) {
  const at = (azDeg: number) => `${50 + (turnBetween(headingDeg, azDeg) / 360) * 100}%`
  const facing = Math.round(wrap360(headingDeg)) % 360
  const description =
    `Facing ${facing}° (${compassPoint(headingDeg)}). ` +
    `The Sun is ${turnWords(headingDeg, sun.azDeg)}${sun.up ? '' : ', behind the land'}. ` +
    `Earth is ${turnWords(headingDeg, earth.azDeg)}${earth.up ? '' : ', behind the land'}.`

  return (
    <div className="sf-compass" role="img" aria-label={description}>
      <div className="sf-compass-tape" aria-hidden="true">
        <span className="sf-compass-field" style={{ width: `${Math.min((acrossDeg / 360) * 100, 100)}%` }} />
        {TICKS.map((az) => (
          <span key={az} className={az % 90 === 0 ? 'sf-tick cardinal' : az % 30 === 0 ? 'sf-tick major' : 'sf-tick'} style={{ left: at(az) }}>
            {az % 30 === 0 && <b>{CARDINALS[az] ?? az}</b>}
          </span>
        ))}
        <span className={earth.up ? 'sf-mark earth' : 'sf-mark earth hidden'} style={{ left: at(earth.azDeg) }} />
        <span className={sun.up ? 'sf-mark sun' : 'sf-mark sun hidden'} style={{ left: at(sun.azDeg) }} />
        <span className="sf-compass-needle" />
      </div>
      <p className="sf-compass-facing" aria-hidden="true">
        Facing <strong>{facing}°</strong> {compassPoint(headingDeg)}
      </p>
    </div>
  )
}
