import { useEffect, useId, useRef, useState } from 'react'
import { horizonsQueryUrl, withinWords } from '../lib/horizonsLink'

interface Props {
  /** The site's place, as the comparison used it. */
  lat: number
  lon: number
  altKm: number
  /** The landing's hour (UTC), which the two links ask NASA about. */
  hour: string
  /** How many hours were compared for each body, and the largest gap found. */
  hours: number
  maxDeg: number
}

/** What a link opens, for its hover text. */
const opens = (body: string) => `Opens NASA's own answer for ${body} at this site and hour. Its last two numbers are the compass bearing and the height above a flat horizon.`

/**
 * The line at the foot of the answer: the claim alone, "Matches Horizons within 0.01°", as one control.
 * Hover explains it. A press opens a small card over the column that says what was compared and offers
 * NASA's own answer for this hour, for the Sun and for Earth. Escape or a press outside closes it.
 */
export function HorizonsClaim({ lat, lon, altKm, hour, hours, maxDeg }: Props) {
  const [open, setOpen] = useState(false)
  const line = useRef<HTMLParagraphElement>(null)
  const claim = useRef<HTMLButtonElement>(null)
  const card = useId()
  const count = hours.toLocaleString('en-US')

  useEffect(() => {
    if (!open) return
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Node && !line.current?.contains(event.target)) setOpen(false)
    }
    // Heard first, and marked as handled, so Escape closes the card and not a panel behind it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      claim.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPress)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPress)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <p className="sl-horizons" ref={line}>
      <button
        ref={claim}
        type="button"
        className="sl-horizons-claim"
        aria-expanded={open}
        aria-controls={open ? card : undefined}
        title={`Our directions to the Sun and Earth agree with NASA JPL's Horizons service at every hour for this site (${count} hours each). The largest gap is rounding.`}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">✓</span> Matches Horizons within {withinWords(maxDeg)}
      </button>
      {open && (
        <span id={card} className="sl-horizons-card" role="group" aria-label="Checked against Horizons">
          <span>
            Sun and Earth directions, compared with NASA JPL Horizons at every hour for this site: {count} hours each.
          </span>
          <span className="sl-horizons-links">
            Reproduce this hour:{' '}
            <a href={horizonsQueryUrl('sun', lat, lon, altKm, hour)} target="_blank" rel="noreferrer" title={opens('the Sun')}>
              Sun
            </a>{' '}
            ·{' '}
            <a href={horizonsQueryUrl('earth', lat, lon, altKm, hour)} target="_blank" rel="noreferrer" title={opens('Earth')}>
              Earth
            </a>
          </span>
        </span>
      )}
    </p>
  )
}
