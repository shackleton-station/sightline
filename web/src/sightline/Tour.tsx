import { useEffect, useRef, useState } from 'react'
import type { RiverState } from '../lib/river'
import { type Box, type Disc, placeBubble, type TourFile, voiceFile } from '../lib/tour'
import { Mascot } from '../scout/Mascot'

interface Props {
  tour: TourFile
  /** Which step is on show, counted from 0. */
  at: number
  onStep: (index: number) => void
  /** Leave the tour: the screen goes back to how the visitor had it. */
  onClose: () => void
  /** Open the Guide at the walkthrough video; null until the video exists. */
  onVideo: (() => void) | null
  /** What the step on show offers to try, as a link under its words; null when it offers nothing. */
  tryIt: { label: string; onPick: () => void } | null
  /** What is in view at the site on show, for Scout's mark. */
  state: RiverState | null
}

/** A window this narrow is a phone: the bubble spans it, at the foot of the screen. */
const PHONE_UNDER_PX = 761
/** How far a ring stands off what it rings. */
const RING_AIR_PX = 4
/** How often the rings and the bubble are placed again, so they follow the screen as it settles or is resized. */
const PLACE_EVERY_MS = 120

/** An element the visitor can see: drawn, with a size, and not inside something hidden. */
function onScreen(el: Element): boolean {
  if (el.closest('[hidden]')) return false
  const box = el.getBoundingClientRect()
  if (box.width < 2 || box.height < 2) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth
}

/** The Moon's disc on screen, from the globe's own figures; null where the Moon is not drawn full-size. */
function moonDisc(): Disc | null {
  const globe = document.querySelector<HTMLElement>('.scout-globe')
  const size = Number(globe?.dataset.discPx)
  if (!globe || !(size > 0)) return null
  const box = globe.getBoundingClientRect()
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, r: size / 2 }
}

/**
 * Scout's tour: he walks the visitor through the real screen. Each step has already put the app in
 * its state (the screen does that); this draws a ring round what the step is about and Scout's
 * bubble with one or two sentences, "3 of 8", and Back, Next and Close. Nothing is drawn over the
 * Moon and nothing is dimmed. Arrow keys step, Escape closes. "Listen" plays each line in Scout's
 * voice from a file rendered ahead of time: off until pressed, so there is never sound without a click.
 */
export function Tour({ tour, at, onStep, onClose, onVideo, tryIt, state }: Props) {
  const step = tour.steps[at]
  const last = at === tour.steps.length - 1
  const bubble = useRef<HTMLElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [rings, setRings] = useState<Box[]>([])
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const [listen, setListen] = useState(false)
  const voice = useRef<HTMLAudioElement | null>(null)

  // The rings and the bubble are placed from where things are on screen, again and again, so they
  // follow the screen while a step's state settles, a sheet scrolls or the window is resized.
  useEffect(() => {
    const lay = () => {
      const found = step.targets.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(onScreen)
      const boxes = found.map((el) => {
        const box = el.getBoundingClientRect()
        return { left: Math.round(box.left - RING_AIR_PX), top: Math.round(box.top - RING_AIR_PX), width: Math.round(box.width + 2 * RING_AIR_PX), height: Math.round(box.height + 2 * RING_AIR_PX) }
      })
      setRings((before) => (JSON.stringify(before) === JSON.stringify(boxes) ? before : boxes))
      const el = bubble.current
      if (!el) return
      const at = placeBubble({ width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, boxes, moonDisc(), window.innerWidth < PHONE_UNDER_PX)
      setPlace((before) => (before && before.left === at.left && before.top === at.top ? before : at))
    }
    lay()
    const timer = window.setInterval(lay, PLACE_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [step])

  // On a phone what a step is about may be further down the sheet: bring it to the sheet's top, clear of the bubble at the foot.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = step.targets.flatMap((selector) => [...document.querySelectorAll(selector)]).find((el) => !el.closest('[hidden]'))
      const sheet = target?.closest('.sl-wrap')
      if (!target || !sheet || window.innerWidth >= PHONE_UNDER_PX) return
      sheet.scrollTop += target.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 12
    }, 80)
    return () => window.clearTimeout(timer)
  }, [step])

  // Arrow keys step and Escape closes. Heard first, and marked as handled, so the screen's own keys (the arrows step time) stay out of it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = event.target instanceof HTMLElement ? event.target.tagName : ''
      if (event.metaKey || event.ctrlKey || event.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' && !last) onStep(at + 1)
      else if (event.key === 'ArrowLeft' && at > 0) onStep(at - 1)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at, last, onStep, onClose])

  // Each step hands the keyboard to "Next", so Enter carries on and a screen reader starts at the step.
  // (Once the bubble has its place: until then it is not shown, and a hidden button cannot take the focus.)
  const placed = place !== null
  useEffect(() => {
    if (placed) next.current?.focus({ preventScroll: true })
  }, [at, placed])

  // "Listen": the step's line, in Scout's voice, from its file. A new step stops the line before it.
  useEffect(() => {
    if (!listen) return
    const audio = new Audio(voiceFile(tour, step))
    voice.current = audio
    // A browser that refuses to play, or a file that is missing, leaves the words on screen: nothing else to do.
    void audio.play().catch(() => {})
    return () => {
      audio.pause()
      voice.current = null
    }
  }, [listen, step, tour])

  return (
    <>
      {rings.map((ring, i) => (
        <div key={i} className="sl-tour-ring" style={ring} aria-hidden="true" />
      ))}
      <section ref={bubble} className="sl-tour" role="dialog" aria-label="Scout's tour" data-step={step.id} style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}>
        <header className="sl-tour-head">
          <Mascot state={state} size={28} />
          <h2 className="sl-tour-title">{step.title}</h2>
          <span className="sl-tour-count">
            {at + 1} of {tour.steps.length}
          </span>
        </header>
        <p className="sl-tour-say" aria-live="polite">
          {step.say}
        </p>
        {tryIt && (
          <button type="button" className="sl-link sl-tour-try" onClick={tryIt.onPick}>
            {tryIt.label} <span aria-hidden="true">›</span>
          </button>
        )}
        <footer className="sl-tour-foot">
          <span className="sl-tour-voice">
            <button type="button" className="sl-small sl-tour-listen" aria-pressed={listen} title="Hear Scout say each step. The voice is AI-generated; the words stay on screen." onClick={() => setListen(!listen)}>
              Listen
            </button>
            <small>{tour.voice.disclosure}</small>
          </span>
          <span className="sl-tour-nav">
            {last && onVideo && (
              <button type="button" className="sl-link sl-tour-video" onClick={onVideo}>
                Watch the walkthrough
              </button>
            )}
            <button type="button" className="sl-small" disabled={at === 0} onClick={() => onStep(at - 1)}>
              Back
            </button>
            <button ref={next} type="button" className="sl-small sl-tour-next" onClick={() => (last ? onClose() : onStep(at + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
            <button type="button" className="sl-small" onClick={onClose}>
              Close
            </button>
          </span>
        </footer>
      </section>
    </>
  )
}
