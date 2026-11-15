import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { LibraryCard, LibraryEntry } from '../lib/library'
import { LibraryCardView } from './LibraryCard'

interface Props {
  start: string
  /** The tray's scenarios as cards; null while the sites' flags are still being read. */
  cards: LibraryCard[]
  /** The letter a card's scenario has in Compare, or null when it is not there. */
  letterOf: (card: LibraryCard) => string | null
  /** Whether Compare has room for one more. */
  room: boolean
  onCompare: (card: LibraryCard) => void
  onRemove: (entry: LibraryEntry) => void
  onOpenCompare: () => void
  onOpenLibrary: () => void
  /** Tells the Planner the tray was looked at, so the library is read. */
  onWanted: () => void
}

/** How long the fan stays after the pointer leaves it, in milliseconds: long enough to cross from the lander to the cards. */
const LEAVE_MS = 300

/** A small lander: the tray's icon. Drawn here, not a picture of any real spacecraft. */
function Lander() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13h8l1.5-5h-11z" />
      <path d="M10 8V5.5h4V8" />
      <path d="M7.5 13 4 20M16.5 13 20 20M2.5 20h3M18.5 20h3M12 13v3.5" />
    </svg>
  )
}

/**
 * The tray: the scenarios pulled in from the library, under a lander with their count. Pointing at
 * the lander or pressing it fans the cards out like a hand of cards; pointing at one lifts it clear
 * of the others. From a card, "Compare" puts its landing in Compare beside your own picks.
 *
 * Pressing pins the fan open (Escape, or a press elsewhere, closes it); pointing only shows it
 * while the pointer is over it. On a phone the cards are a plain list.
 */
export function LibraryTray({ start, cards, letterOf, room, onCompare, onRemove, onOpenCompare, onOpenLibrary, onWanted }: Props) {
  const [pinned, setPinned] = useState(false)
  const [over, setOver] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // The fan hangs under the whole top bar, so the pointer may cross a gap on its way down: leaving closes it a moment later, not at once.
  const leaving = useRef<number | undefined>(undefined)
  const enter = () => {
    window.clearTimeout(leaving.current)
    setOver(true)
  }
  const leave = () => {
    window.clearTimeout(leaving.current)
    leaving.current = window.setTimeout(() => setOver(false), LEAVE_MS)
  }
  useEffect(() => () => window.clearTimeout(leaving.current), [])
  const open = pinned || over
  useEffect(() => {
    if (open) onWanted()
  }, [open, onWanted])
  useEffect(() => {
    if (!pinned) return
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <div ref={root} className="lib-tray" onPointerEnter={(event) => event.pointerType === 'mouse' && enter()} onPointerLeave={leave}>
      <button type="button" className={`lib-tray-icon ${cards.length > 0 ? 'has' : ''}`} aria-expanded={open} aria-controls="lib-tray-fan" title="The landings you pulled in from the library" onClick={() => setPinned(!pinned)}>
        <Lander />
        <span>Tray</span>
        <small aria-label={`${cards.length} pulled in`}>{cards.length}</small>
      </button>
      {open && (
        <div id="lib-tray-fan" className="lib-tray-fan" role="region" aria-label="Pulled in from the library" style={{ '--n': Math.max(cards.length, 2) } as CSSProperties}>
          <div className="lib-tray-box">
          {cards.length === 0 ? (
            <p className="lib-tray-empty">
              Nothing pulled in yet.{' '}
              <button type="button" className="lib-link" onClick={onOpenLibrary}>
                Search the library
              </button>{' '}
              and press “Pull in” on a landing.
            </p>
          ) : (
            <>
              <ul className="lib-fan" style={{ '--n': cards.length } as CSSProperties}>
                {cards.map((card, i) => {
                  const letter = letterOf(card)
                  return (
                    <li key={card.key} style={{ '--i': i } as CSSProperties} tabIndex={0}>
                      <LibraryCardView card={card} start={start} small>
                        <button type="button" className="sl-small" disabled={letter !== null || !room || !card.scenario} title={letter ? `Already in Compare as ${letter}` : room ? 'Add this landing to Compare' : 'Compare holds four: remove one first'} onClick={() => onCompare(card)}>
                          {letter ? `In Compare · ${letter}` : room ? 'Compare' : 'Compare is full'}
                        </button>
                        <button type="button" className="lib-x" aria-label={`Take ${card.place} out of the tray`} onClick={() => onRemove(card.entry)}>
                          ✕
                        </button>
                      </LibraryCardView>
                    </li>
                  )
                })}
              </ul>
              <p className="lib-tray-foot">
                <button type="button" className="lib-link" onClick={onOpenCompare}>
                  Open Compare
                </button>
                <button type="button" className="lib-link" onClick={onOpenLibrary}>
                  Find more
                </button>
              </p>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
