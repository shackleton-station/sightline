import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ClockIcon, LayersIcon, SparkIcon, TargetIcon } from './icons'
import { type Box, cardPlace, markTourSeen, TOUR } from './tour'

const STEP_ICONS: Record<string, typeof ClockIcon> = { place: TargetIcon, layers: LayersIcon, time: ClockIcon, scout: SparkIcon }

/** The box of what a step points at, or null when it isn't on the page (or the step has no target). */
function boxOf(target: string | null): Box | null {
  if (!target) return null
  const element = document.querySelector(`[data-tour="${target}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
}

/**
 * The tutorial overlay: the page dims, a ring lights the part a step is about, and a card beside it
 * says what that part does. Back, Next, the step dots and Escape work from the keyboard; finishing
 * or skipping remembers it, and the Tour button opens it again.
 */
export function AtlasTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [place, setPlace] = useState({ left: 16, top: 16 })
  const card = useRef<HTMLElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const current = TOUR[step]
  const last = step === TOUR.length - 1

  const close = () => {
    markTourSeen()
    onClose()
  }

  // Find the step's target and put the card beside it; again when the window changes size.
  useLayoutEffect(() => {
    const measure = () => {
      const target = boxOf(current.target)
      setBox(target)
      const size = card.current ? { width: card.current.offsetWidth, height: card.current.offsetHeight } : { width: 400, height: 260 }
      setPlace(cardPlace(target, { width: window.innerWidth, height: window.innerHeight }, size))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [current.target])

  useEffect(() => {
    next.current?.focus()
  }, [step])

  const Icon = current.target ? STEP_ICONS[current.target] : null
  const pad = 8

  return (
    <div className="atlas-tour">
      {box ? (
        <div
          className="atlas-tour-ring"
          aria-hidden="true"
          style={{ left: box.left - pad, top: box.top - pad, width: box.width + 2 * pad, height: box.height + 2 * pad }}
        />
      ) : (
        <div className="atlas-tour-dim" aria-hidden="true" />
      )}
      <section
        ref={card}
        className="atlas-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-tour-title"
        style={{ left: place.left, top: place.top }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
          // Tab stays inside the card while the tour is open.
          if (event.key !== 'Tab' || !card.current) return
          const buttons = [...card.current.querySelectorAll('button')]
          const first = buttons[0]
          const end = buttons[buttons.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            end.focus()
          } else if (!event.shiftKey && document.activeElement === end) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="atlas-tour-head">
          <span className="atlas-tour-icon" aria-hidden="true">
            {Icon ? <Icon size={22} /> : <span className="atlas-tour-moon" />}
          </span>
          <span>
            <span className="atlas-eyebrow">
              Step {step + 1} of {TOUR.length}
            </span>
            <h2 id="atlas-tour-title">{current.title}</h2>
          </span>
        </div>
        <p className="atlas-tour-body">{current.body}</p>
        <div className="atlas-tour-foot">
          <span className="atlas-tour-dots">
            {TOUR.map((item, i) => (
              <button
                key={item.title}
                type="button"
                className={i === step ? 'on' : i < step ? 'done' : undefined}
                aria-label={`Step ${i + 1}: ${item.title}`}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
              />
            ))}
          </span>
          <button type="button" className="atlas-tour-skip" onClick={close}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          {step > 0 && (
            <button type="button" className="atlas-tour-back" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button type="button" ref={next} className="atlas-tour-next" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? 'Start exploring' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  )
}
