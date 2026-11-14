import { useState } from 'react'
import type { RiverState } from '../lib/river'
import { STATE_WORDS } from '../lib/sightline'

interface Props {
  /**
   * What is in view at the site on show right now: the Sun, Earth, both or neither. Null when no
   * site is chosen; the mark then shows the Sun's gold.
   */
  state: RiverState | null
  /** The size it is drawn at, in pixels. At 24 px and under the sightline is dropped and the ring thickened, so it still reads. */
  size?: number
  /** What Scout is saying. When it changes, the disc pulses once. */
  pulse?: string
}

/** The app's colour language: gold is the Sun, blue is Earth, green is both, grey is neither. */
const INK = { sun: '#e9b44c', earth: '#5b9bea', both: '#57c08a', none: '#8b91a0' }
const RING_GOLD = '#e9b44c'
const NIGHT = '#0b0a10'
const MOON_GREY = '#8f8b82'
const PALE = '#ece8dd'

/**
 * Scout's mark: a round badge with a gold ring, lunar ground with a faceted ridge, and one small
 * disc above the ridge joined to it by a thin line, the sightline. The disc carries the state of the
 * site on show: gold for the Sun, blue for Earth, green for both, and for neither an empty grey ring
 * on a dashed line, so the state never rests on colour alone. Its name says the state in words.
 *
 * Flat shapes drawn by hand as SVG (by an AI assistant, as the pages that show it say), so it is
 * a few hundred bytes and can change with the data.
 */
export function Mascot({ state, size, pulse }: Props) {
  // The first sentence is not a change; every one after it is.
  const [first] = useState(pulse)
  const small = size !== undefined && size <= 24
  const neither = state === 'none'
  const ink = INK[state ?? 'sun']
  const name = state ? `Scout: ${STATE_WORDS[state]}` : 'Scout'
  return (
    <svg className={`scout-mascot scout-badge is-${state ?? 'idle'}${small ? ' is-small' : ''}`} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={name}>
      <circle cx="32" cy="32" r={small ? 28.5 : 29} fill={NIGHT} stroke={RING_GOLD} strokeWidth={small ? 4 : 2} />
      {/* Lunar ground: a faceted ridge, closed along the inside of the ring. */}
      <path d={small ? 'M7 42 L16 38 L24 43 L33 37 L42 42 L50 38 L57 42 A 27 27 0 0 1 7 42 Z' : 'M5.5 40 L16 37 L24 41 L33 36 L42 40 L50 37 L58.5 40 A 27.7 27.7 0 0 1 5.5 40 Z'} fill={MOON_GREY} />
      {/* The sightline, from the ridge up to the body. Too fine to read at the small size. */}
      {!small && <path d="M33 36 L42 20" fill="none" stroke={neither ? INK.none : PALE} strokeWidth="1.5" strokeLinecap="round" strokeDasharray={neither ? '2.5 3' : undefined} />}
      <circle
        key={pulse}
        className={pulse !== first ? 'scout-badge-disc is-pulsing' : 'scout-badge-disc'}
        cx={small ? 40 : 42}
        cy={small ? 22 : 20}
        r={small ? (neither ? 7 : 8.5) : neither ? 5 : 6}
        fill={neither ? NIGHT : ink}
        stroke={neither ? INK.none : 'none'}
        strokeWidth={neither ? (small ? 3 : 2) : 0}
      />
    </svg>
  )
}
