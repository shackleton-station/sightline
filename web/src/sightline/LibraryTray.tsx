import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { LibraryCard } from '../lib/library'
import { SCENARIO_LETTERS } from '../lib/sightlineMission'
import { LibraryCardView } from './LibraryCard'

interface Props {
  start: string
  /** The plan's scenarios as cards: the card at index i is scenario i (A, B, C, D). */
  cards: LibraryCard[]
  /** The scenario on show. */
  active: number
  /** Go to the main screen with this scenario on show. */
  onShow: (index: number) => void
  /** Take this scenario out of the plan. The plan always keeps one. */
  onRemove: (index: number) => void
  onOpenCompare: () => void
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
 * The tray: the plan itself, as cards, under a lander with their count. A landing added from the
 * library is a scenario of the plan (C after A and B), so it is here, in Compare and on the main
 * screen at once. Pointing at the lander or pressing it fans the cards out like a hand of cards;
 * pointing at one lifts it clear of the others. From a card, "Show" goes to the main screen with it on show.
 *
 * Pressing pins the fan open (Escape, or a press elsewhere, closes it); pointing only shows it
 * while the pointer is over it. On a phone the cards are a plain list.
 */
export function LibraryTray({ start, cards, active, onShow, onRemove, onOpenCompare }: Props) {
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
      <button type="button" className={`lib-tray-icon ${cards.length > 0 ? 'has' : ''}`} aria-expanded={open} aria-controls="lib-tray-fan" title="Your plan: its scenarios, with the landings you added from the library" onClick={() => setPinned(!pinned)}>
        <Lander />
        <span>Plan</span>
        <small aria-label={`${cards.length} in your plan`}>{cards.length}</small>
      </button>
      {open && (
        <div id="lib-tray-fan" className="lib-tray-fan" role="region" aria-label="Your plan" style={{ '--n': Math.max(cards.length, 2) } as CSSProperties}>
          <div className="lib-tray-box">
          {(
            <>
              <ul className="lib-fan" style={{ '--n': cards.length } as CSSProperties}>
                {cards.map((card, i) => (
                  <li key={card.key} style={{ '--i': i } as CSSProperties} tabIndex={0}>
                    <LibraryCardView card={card} start={start} small>
                      <button type="button" className="sl-small" aria-pressed={i === active} title={`Goes to the main screen with scenario ${SCENARIO_LETTERS[i]} on show`} onClick={() => onShow(i)}>
                        {SCENARIO_LETTERS[i]} · Show
                      </button>
                      <button type="button" className="lib-x" disabled={cards.length < 2} aria-label={`Take scenario ${SCENARIO_LETTERS[i]}, ${card.place}, out of the plan`} onClick={() => onRemove(i)}>
                        ✕
                      </button>
                    </LibraryCardView>
                  </li>
                ))}
              </ul>
              <p className="lib-tray-foot">
                <button
                  type="button"
                  className="lib-link"
                  onClick={() => {
                    // The tray folds away, so it is not left lying over the table it opened.
                    setPinned(false)
                    setOver(false)
                    onOpenCompare()
                  }}
                >
                  Open Compare
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
