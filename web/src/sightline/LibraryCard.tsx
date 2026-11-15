import type { ReactNode } from 'react'
import type { Band, LibraryCard } from '../lib/library'
import { clockTime } from '../lib/sightline'
import { shortReason } from '../lib/sightlineSky'

const pct = (share: number) => `${Math.round(share * 100)}%`

const STATE_WORDS = { both: 'the Sun and Earth', sun: 'the Sun only', earth: 'Earth only', none: 'neither' }

/**
 * The mission as a dial: one turn of the ring is the mission from landing (at the top, going
 * clockwise) to its end, colored by what is in view. In the middle, whether the landing fits. The
 * same shares are written beside the dial, so the colors are never the only way to read it.
 */
export function MissionDial({ bands, fits, size = 56 }: { bands: Band[] | null; fits: boolean | null; size?: number }) {
  const mark = fits === null ? '?' : fits ? '✓' : '✗'
  const words = bands ? bands.map((band) => `${pct(band.to - band.from)} ${STATE_WORDS[band.state]}`).join(', then ') : 'not worked out yet'
  return (
    <svg className={`lib-dial ${fits === null ? 'unknown' : fits ? 'fits' : 'misses'}`} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`The mission from this landing: ${words}`}>
      <circle className="lib-dial-track" cx="20" cy="20" r="15" />
      <g transform="rotate(-90 20 20)">
        {bands?.map((band) => (
          <circle key={band.from} className={`lib-band-${band.state}`} cx="20" cy="20" r="15" pathLength={1} strokeDasharray={`${band.to - band.from} 1`} strokeDashoffset={-band.from} />
        ))}
      </g>
      <text x="20" y="20" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
        {mark}
      </text>
    </svg>
  )
}

/** When the card's landing is, as the rest of the screen writes a time; the plain date when it is outside the data. */
function landingWords(card: LibraryCard, start: string): string {
  return card.scenario ? clockTime(start, card.scenario.landing) : `${card.entry.landing.slice(0, 10)} (outside our data)`
}

/** Whether the landing fits, in a few words. */
function fitWords(card: LibraryCard): string {
  if (card.fits === null) return card.scenario ? 'Worked out once it is in your plan' : 'Cannot be opened here'
  return card.fits ? 'Fits your mission' : `Misses: ${card.problems.map(shortReason).join(' · ')}`
}

interface Props {
  card: LibraryCard
  start: string
  /** The card's buttons. */
  children: ReactNode
  /** The small card of the tray: the dial, the place and the time only. */
  small?: boolean
}

/** One scenario from the library: the mission dial, where and when, the plan it came from, and how it does against the mission on screen. */
export function LibraryCardView({ card, start, children, small = false }: Props) {
  return (
    <article className={`lib-card ${small ? 'small' : ''} ${card.fits === null ? 'unknown' : card.fits ? 'fits' : 'misses'}`} aria-label={`${card.place}, ${landingWords(card, start)}`}>
      <MissionDial bands={card.bands} fits={card.fits} size={small ? 44 : 56} />
      <div className="lib-card-text">
        <h4>{card.place}</h4>
        <p className="lib-when">{landingWords(card, start)}</p>
        <p className="lib-from">
          from <q>{card.entry.title}</q>
        </p>
        {!small && (
          <>
            <p className={`lib-fit ${card.fits === null ? '' : card.fits ? 'fits' : 'misses'}`}>{fitWords(card)}</p>
            {card.sunShare !== null && card.earthShare !== null && (
              <p className="lib-shares">
                Sun {pct(card.sunShare)} · Earth {pct(card.earthShare)} of the mission
                {card.monthShare !== null && <> · {pct(card.monthShare)} of that month’s days have a landing that fits</>}
              </p>
            )}
          </>
        )}
      </div>
      <div className="lib-card-actions">{children}</div>
    </article>
  )
}
