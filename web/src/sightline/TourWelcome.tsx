import { useEffect, useRef } from 'react'
import type { RiverState } from '../lib/river'
import { Mascot } from '../scout/Mascot'

interface Props {
  /** How long the tour takes to read, in words: "about two minutes". */
  reads: string
  onTake: () => void
  /** "Skip", or Escape: the card does not come back in this browser; the chip stays. */
  onSkip: () => void
  /** What is in view at the site on show, for Scout's mark. */
  state: RiverState | null
}

/**
 * Scout's welcome, on a first visit to the front page: what Sightline answers, what the tour costs
 * to read, and two buttons, "Take the tour" and "Skip". It is the tour's card in the tour's home
 * corner, alone: nothing is shaded until the tour is started, so the first thing a visitor sees is
 * still the Moon. It takes the keyboard without scrolling the page, and Escape skips it.
 */
export function TourWelcome({ reads, onTake, onSkip, state }: Props) {
  const take = useRef<HTMLButtonElement>(null)
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
  return (
    <section className="sl-tour sl-tour-welcome" role="dialog" aria-label="Welcome to Sightline" data-beside-moon>
      <header className="sl-tour-head">
        <p className="sl-tour-top">
          <span className="sl-tour-chapter">Welcome</span>
        </p>
        <div className="sl-tour-name">
          <Mascot state={state} size={30} />
          <h2 className="sl-tour-title">New here?</h2>
        </div>
      </header>
      <p className="sl-tour-say is-long">
        Sightline answers one question: can a lander at this place, landing at this hour, keep the Sun for power and Earth for radio? Scout’s tour follows one landing plan across the real
        screen: {reads} to read.
      </p>
      <footer className="sl-tour-foot">
        <span className="sl-tour-nav">
          <button ref={take} type="button" className="sl-small sl-tour-next" onClick={onTake}>
            Take the tour
          </button>
          <button type="button" className="sl-small sl-tour-skip" title="Closes this card for good in this browser. “Take the tour” stays on the front page." onClick={onSkip}>
            Skip
          </button>
        </span>
      </footer>
    </section>
  )
}
