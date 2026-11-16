import { useEffect, useRef, useState } from 'react'
import type { RiverState } from '../lib/river'
import { Mascot } from '../scout/Mascot'

/** Where the card stood when "Take the tour" was pressed, so the tour's first card can start from there and glide home. */
export interface WelcomePlace {
  left: number
  bottom: number
}

interface Props {
  /** How long the tour takes to read, in words: "about two minutes". */
  reads: string
  onTake: (from: WelcomePlace | null) => void
  /** "Skip", Escape, or a press anywhere outside the card: it closes for this opening of the page; the chip stays. */
  onSkip: () => void
  /** "Don't show this again": the one thing that keeps the card away in this browser. */
  onNever: () => void
  /** What is in view at the site on show, for Scout's mark. */
  state: RiverState | null
}

/** A window this narrow is a phone: the card spans it, near the foot of the screen. */
const PHONE_UNDER_PX = 761
/** The closest the card comes to the window's edge. */
const EDGE_PX = 12

/**
 * Scout's welcome, each time the front page is opened: the first thing a visitor notices. One card,
 * centered over the Moon, says what Sightline answers and what the tour costs to read, with two
 * buttons, "Take the tour" and "Skip". The page behind it is dimmed a little, far less than the
 * tour's own shade, so the Moon still reads as the Moon and nothing else competes; Scout's panel is
 * under that dim. It takes the keyboard without scrolling the page. Escape, "Skip" or a press
 * outside the card closes it until the page is opened again; "Don't show this again", small and
 * quiet under the buttons, keeps it away in this browser for someone who comes often.
 */
export function TourWelcome({ reads, onTake, onSkip, onNever, state }: Props) {
  const card = useRef<HTMLElement>(null)
  const take = useRef<HTMLButtonElement>(null)
  // The Moon's center on screen, which moves when Scout's panel opens beside it or the window is resized: the card follows it.
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const find = () => {
      const globe = document.querySelector('.scout-globe')?.getBoundingClientRect()
      const el = card.current
      if (!globe || !el || window.innerWidth < PHONE_UNDER_PX) return setCenter(null)
      // Kept whole inside the window, whatever the Moon's place.
      const halfW = el.offsetWidth / 2 + EDGE_PX
      const halfH = el.offsetHeight / 2 + EDGE_PX
      const x = Math.round(Math.min(Math.max((globe.left + globe.right) / 2, halfW), window.innerWidth - halfW))
      const y = Math.round(Math.min(Math.max((globe.top + globe.bottom) / 2, halfH), window.innerHeight - halfH))
      setCenter((before) => (before && before.x === x && before.y === y ? before : { x, y }))
    }
    find()
    const timer = window.setInterval(find, 200)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    take.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onSkip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onSkip])
  /** Where the card stands now, for the tour's first card to start from (not on a phone, whose cards are placed from the top). */
  const placeNow = (): WelcomePlace | null => {
    const box = card.current?.getBoundingClientRect()
    return box && window.innerWidth >= PHONE_UNDER_PX ? { left: Math.round(box.left), bottom: Math.round(window.innerHeight - box.bottom) } : null
  }
  return (
    <>
      {/* The page, dimmed a little. A press on it is a press outside the card. */}
      <div className="sl-welcome-dim" aria-hidden="true" onClick={onSkip} />
      <section ref={card} className="sl-tour sl-tour-welcome" role="dialog" aria-modal="true" aria-label="Welcome to Sightline" style={center ? { left: center.x, top: center.y } : undefined}>
        <header className="sl-tour-head">
          <p className="sl-tour-top">
            <span className="sl-tour-chapter">Welcome</span>
          </p>
          <div className="sl-tour-name">
            <Mascot state={state} size={34} />
            <h2 className="sl-tour-title">Where to land on the Moon, and when</h2>
          </div>
        </header>
        <p className="sl-tour-say is-long">
          Sightline answers one question: can a lander at this place, landing at this hour, keep the Sun for power and Earth for radio? Scout’s tour follows one landing plan across the
          real screen: {reads} to read.
        </p>
        <footer className="sl-tour-foot">
          <span className="sl-tour-nav">
            <button ref={take} type="button" className="sl-small sl-tour-next" onClick={() => onTake(placeNow())}>
              Take the tour
            </button>
            <button type="button" className="sl-small sl-tour-skip" title="Closes this card. “Take the tour” stays on the front page, and the card is back the next time the page is opened." onClick={onSkip}>
              Skip
            </button>
          </span>
          <button type="button" className="sl-link sl-tour-never" title="Closes this card and keeps it away in this browser. “Take the tour” stays on the front page." onClick={onNever}>
            Don’t show this again
          </button>
        </footer>
      </section>
    </>
  )
}
