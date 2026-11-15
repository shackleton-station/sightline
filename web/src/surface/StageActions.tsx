import { useEffect, useRef } from 'react'
import type { BodyRadii } from '../lib/surfaceView'
import { type MotionStatus, motionWords } from './useMotionLook'

interface Props {
  /** Whether to offer looking around with the motion sensor: on phones and tablets only. */
  offerMotion: boolean
  motion: MotionStatus
  onMotion: () => void
  /** The Sun's and Earth's radii this hour (degrees), for saying how big they are drawn. */
  radii: BodyRadii
  obsHeightM: number
}

const across = (radiusDeg: number) => (2 * radiusDeg).toFixed(2)

/** Under the picture: steering with the phone, and what is drawn. */
export function StageActions({ offerMotion, motion, onMotion, radii, obsHeightM }: Props) {
  const steering = motion === 'on' || motion === 'asking'
  const words = motionWords(motion)
  // Escape closes the note, wherever in this page the keyboard is.
  const about = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && about.current?.open) about.current.open = false
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="sf-actions">
      {offerMotion && (
        <button type="button" className="sf-motion" aria-pressed={steering} onClick={onMotion}>
          {steering ? 'Stop following the phone' : 'Look around by moving your phone'}
        </button>
      )}
      {words && (
        <p className={motion === 'on' || motion === 'asking' ? 'sf-motion-says' : 'sf-motion-says problem'} role="status">
          {words}
        </p>
      )}
      <details className="sf-about" ref={about}>
        {/* The one thing a viewer must not miss is on the picture itself; the link holds the rest. */}
        <summary>
          <span className="sf-about-short">The skyline is NASA LOLA terrain. The ground below it is a plain fill.</span> <span className="sf-about-more">What this picture is</span>
        </summary>
        <ul>
          <li>
            The land is this site’s horizon, computed from NASA’s LOLA terrain for a point {obsHeightM} m above the ground: 720 directions, joined by
            straight lines. That top edge is the data.
          </li>
          <li>
            The ground under the edge is a plain fill: nothing is drawn on it. It is lit while the Sun is in view, by the share of the disk in view,
            a little brighter on the side the Sun is on, and dark when the Sun is hidden. No shadows are cast by the land.
          </li>
          <li>
            The Sun and Earth are where the ephemeris puts them this hour, at the size they have from here: {across(radii.sun)}° and{' '}
            {across(radii.earth)}° across. One the model counts as hidden is outlined, not drawn.
          </li>
          <li>Earth’s lit part is its true phase. Its face is NASA’s Blue Marble picture, for looks: which side faces the Moon is not modelled.</li>
          <li>The glow round the Sun is camera glare, to help find it. The stars are decoration, not a star map.</li>
          <li>
            The data is hourly. The dots are where the Sun and Earth are on the hour, from a day before to two days after (every few hours where they
            would run together): filled where the model has them up.
            Between two hours the disks slide in a straight line, and come to rest on the hour’s own position.
          </li>
        </ul>
      </details>
    </div>
  )
}
