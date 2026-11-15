import { useEffect, useRef, useState } from 'react'
import type { RiverState } from '../lib/river'
import { type Box, type Disc, placeBubble, type TourStep, voiceFile } from '../lib/tour'
import { Mascot } from '../scout/Mascot'

interface Props {
  /** What the bubble is called for a screen reader: "Scout's tour", or a feature guide's name. */
  name: string
  /** The steps on show: the main tour's, or a feature guide's. */
  steps: TourStep[]
  /** The tour whose voice files say these steps; null for steps that have none (the feature guides), which then offer no "Listen". */
  voice: { voice: { disclosure: string; files: string; seconds?: number } } | null
  /** What the last step's button says: where it leaves the visitor ("Start planning" for the tour, "Done" for a feature guide). */
  finish: string
  /** Which step is on show, counted from 0. */
  at: number
  onStep: (index: number) => void
  /** Leave the tour: the screen goes back to how the visitor had it. */
  onClose: () => void
  /** "Done" on the last step: the tour has been taken to its end. */
  onDone: () => void
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
/** The closest a ring comes to the window's edge. */
const RING_EDGE_PX = 2
/** How often the rings and the bubble are placed again, so they follow the screen as it settles or is resized. */
const PLACE_EVERY_MS = 120
/** The corners of the lit part round a ring (the ring's own, and the air it stands off). */
const LIT_RADIUS_PX = 12
/** How long the lit part takes to move from one step's place to the next. */
const MOVE_MS = 280
/** A new step's parts may take this long to arrive (a panel opening): until then the lit part stays where it was, so the page never flashes fully shaded. */
const HOLD_MS = 900
/** With this much of the window lit, the step is about the whole screen: nothing is shaded. */
const WHOLE_SCREEN = 0.6

/** The lit parts of the page: a box round each thing ringed or lit, and the Moon's disc when the step is about the Moon itself. */
interface Lit {
  boxes: Box[]
  moon: Disc | null
}

const NOTHING_LIT: Lit = { boxes: [], moon: null }
const between = (a: number, b: number, t: number) => a + (b - a) * t
/** One set of lit parts on the way to another: boxes pair off in order, and one with no partner is there at once. */
function partWay(from: Lit, to: Lit, t: number): Lit {
  return {
    boxes: to.boxes.map((box, i) => {
      const was = from.boxes[i]
      return was ? { left: between(was.left, box.left, t), top: between(was.top, box.top, t), width: between(was.width, box.width, t), height: between(was.height, box.height, t) } : box
    }),
    moon: to.moon && from.moon ? { x: between(from.moon.x, to.moon.x, t), y: between(from.moon.y, to.moon.y, t), r: between(from.moon.r, to.moon.r, t) } : to.moon,
  }
}

/** "2:10": minutes and seconds. */
function clockWords(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`
}

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
  const x = (box.left + box.right) / 2
  const y = (box.top + box.bottom) / 2
  // On a phone a panel fills the screen: the Moon is behind it, out of sight, and nothing can be drawn over it.
  if (document.elementFromPoint(x, y)?.closest('.sl-drawer')) return null
  return { x, y, r: size / 2 }
}

/**
 * Scout's tour, and the feature guides: he walks the visitor through the real screen. Each step has
 * already put the app in its state (the screen does that). This shades the page a little except
 * what the step is about, which keeps its full brightness and gets a ring, and draws Scout's card:
 * the step's count and title, a line a room can read, a dot for each step, Back and Next, and a way
 * out. The shade takes no clicks, so whatever a step rings can still be pressed, and it moves with
 * the ring from step to step (at once where motion is reduced). The card is never over what it
 * rings nor over the Moon's disc. Arrow keys and a clicker's Page Down and Page Up step it; Escape
 * closes it. "Listen" plays each line in Scout's voice from a file rendered ahead of time, off
 * until pressed, so there is never sound without a click; "Play through" moves on when a line ends.
 * Dimming the page round what a step is about was Misha's idea (sightline#231).
 */
export function Tour({ name, steps, voice, finish, at, onStep, onClose, onDone, onVideo, tryIt, state }: Props) {
  const step = steps[at]
  const last = at === steps.length - 1
  // A step may press a control itself on the first "Next", to show a before and an after: which step has done so.
  const [pressedAt, setPressedAt] = useState<string | null>(null)
  const pressed = pressedAt === step.id
  const waiting = Boolean(step.press) && !pressed
  /** Go to a step: it starts as it was written, with nothing pressed yet. */
  const go = (index: number) => {
    setPressedAt(null)
    onStep(index)
  }
  /** "Next": the step's own press first, if it has one to do; then the next step, or the end. */
  const forward = () => {
    if (waiting && step.press) {
      document.querySelector<HTMLElement>(step.press)?.click()
      setPressedAt(step.id)
    } else if (last) onDone()
    else go(at + 1)
  }
  const targets = pressed && step.after ? step.after : step.targets
  const bubble = useRef<HTMLElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [rings, setRings] = useState<Box[]>([])
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const [listen, setListen] = useState(false)
  const speaking = useRef<HTMLAudioElement | null>(null)
  // "Play through": each step's voice in turn, moving on by itself when a line ends. Off until pressed.
  const [through, setThrough] = useState(false)
  /** What the voice needs to know when a line ends, as it is now and not as it was when the line began. */
  const auto = useRef({ through: false, waiting: false, last: false, forward: () => {} })

  // The lit parts of the page, as drawn (on their way to where the step's things are), and where they are going.
  const [lit, setLit] = useState<Lit>(NOTHING_LIT)
  const drawn = useRef<Lit>(NOTHING_LIT)
  const goal = useRef('')
  const moving = useRef(0)
  /** Send the lit parts to a new place: a short glide from where they are drawn now, or at once where motion is reduced. */
  const light = (to: Lit) => {
    const key = JSON.stringify(to)
    if (key === goal.current) return
    goal.current = key
    window.cancelAnimationFrame(moving.current)
    const from = drawn.current
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || (from.boxes.length === 0 && !from.moon)
    const began = performance.now()
    const frame = (now: number) => {
      const t = still ? 1 : Math.min((now - began) / MOVE_MS, 1)
      // Eased: quick away, gentle to rest.
      drawn.current = t >= 1 ? to : partWay(from, to, 1 - (1 - t) ** 3)
      setLit(drawn.current)
      if (t < 1) moving.current = window.requestAnimationFrame(frame)
    }
    frame(began)
  }
  useEffect(() => () => window.cancelAnimationFrame(moving.current), [])

  // The rings, the lit parts and the card are placed from where things are on screen, again and
  // again, so they follow the screen while a step's state settles, a sheet scrolls or the window is resized.
  useEffect(() => {
    const arrived = performance.now()
    const lay = () => {
      const boxOf = (el: Element): Box => {
        const box = el.getBoundingClientRect()
        // A ring stays inside the window: round something wider or taller than the screen (a table on a
        // phone) it rings the part that shows, and one at the screen's edge is not drawn half off it.
        const left = Math.max(Math.round(box.left - RING_AIR_PX), RING_EDGE_PX)
        const top = Math.max(Math.round(box.top - RING_AIR_PX), RING_EDGE_PX)
        const right = Math.min(Math.round(box.right + RING_AIR_PX), window.innerWidth - RING_EDGE_PX)
        const bottom = Math.min(Math.round(box.bottom + RING_AIR_PX), window.innerHeight - RING_EDGE_PX)
        return { left, top, width: right - left, height: bottom - top }
      }
      const boxes = targets
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter(onScreen)
        .map(boxOf)
      // A new step's things may not be on screen yet: what the last step lit stays lit until they are.
      if (boxes.length === 0 && performance.now() - arrived < HOLD_MS) return
      setRings((before) => (JSON.stringify(before) === JSON.stringify(boxes) ? before : boxes))
      // Lit as well, with no ring: what the step names beside its subject, and the Moon when the step is about the Moon.
      const also = (step.lit ?? []).filter((selector) => selector !== 'moon')
      light({ boxes: [...boxes, ...also.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(onScreen).map(boxOf)], moon: step.lit?.includes('moon') ? moonDisc() : null })
      const el = bubble.current
      if (!el) return
      const at = placeBubble({ width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, boxes, moonDisc(), window.innerWidth < PHONE_UNDER_PX)
      setPlace((before) => (before && before.left === at.left && before.top === at.top ? before : at))
    }
    lay()
    const timer = window.setInterval(lay, PLACE_EVERY_MS)
    return () => window.clearInterval(timer)
    // The step and whether it has pressed its control decide what is ringed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pressed])

  // On a phone what a step is about may be further down whatever holds it (the sheet, a panel, the
  // Planner's page): bring it to the top of the nearest thing that scrolls, clear of the bubble at the foot.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = step.targets.flatMap((selector) => [...document.querySelectorAll(selector)]).find((el) => !el.closest('[hidden]'))
      if (!target || window.innerWidth >= PHONE_UNDER_PX) return
      let holder = target.parentElement
      while (holder && !(holder.scrollHeight > holder.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(holder).overflowY))) holder = holder.parentElement
      if (!holder) return
      holder.scrollTop += target.getBoundingClientRect().top - Math.max(holder.getBoundingClientRect().top, 0) - 12
    }, 80)
    return () => window.clearTimeout(timer)
  }, [step])

  // Arrow keys step and Escape closes; a presenter's clicker sends Page Down and Page Up. Heard first,
  // and marked as handled, so the screen's own keys (the arrows step time) stay out of it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = event.target instanceof HTMLElement ? event.target.tagName : ''
      if (event.metaKey || event.ctrlKey || event.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const onward = event.key === 'ArrowRight' || event.key === 'PageDown'
      const back = event.key === 'ArrowLeft' || event.key === 'PageUp'
      if (event.key === 'Escape') onClose()
      else if (onward && (!last || waiting)) forward()
      else if (back && at > 0) go(at - 1)
      else if (!(event.key === 'PageDown' || event.key === 'PageUp')) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // `forward` and `go` are made anew each render from the same values listed here.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [at, last, waiting, onStep, onClose])

  // Each step hands the keyboard to "Next", so Enter carries on and a screen reader starts at the step.
  // (Once the bubble has its place: until then it is not shown, and a hidden button cannot take the focus.)
  const placed = place !== null
  useEffect(() => {
    if (placed) next.current?.focus({ preventScroll: true })
  }, [at, placed])

  useEffect(() => {
    auto.current = { through, waiting, last, forward }
  })
  // "Listen": the step's line, in Scout's voice, from its file. A new step stops the line before it.
  // Playing through, a step that presses a control does so as the voice reaches the words for it, and
  // when the line ends the tour moves on (the last step stays, with its button for the presenter).
  useEffect(() => {
    if (!listen || !voice) return
    const audio = new Audio(voiceFile(voice, step))
    speaking.current = audio
    let timer = 0
    const pressAt = step.press && step.pressOn && step.say.includes(step.pressOn) ? step.say.indexOf(step.pressOn) / step.say.length : null
    const onTime = () => {
      if (auto.current.through && auto.current.waiting && pressAt !== null && audio.duration > 0 && audio.currentTime >= audio.duration * pressAt) auto.current.forward()
    }
    const onEnded = () => {
      if (!auto.current.through) return
      // A press the voice did not reach is made now, and looked at for a moment, before moving on.
      const pressing = auto.current.waiting
      if (pressing) auto.current.forward()
      timer = window.setTimeout(() => !auto.current.last && auto.current.through && auto.current.forward(), pressing ? 2500 : 900)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    // A browser that refuses to play, or a file that is missing, leaves the words on screen: nothing else to do.
    void audio.play().catch(() => {})
    return () => {
      window.clearTimeout(timer)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
      audio.pause()
      speaking.current = null
    }
  }, [listen, step, voice])

  // For a presenter: the time gone since the tour began, against the time it takes played through.
  const whole = voice?.voice.seconds ?? null
  const [gone, setGone] = useState(0)
  useEffect(() => {
    if (whole === null) return
    const began = Date.now()
    const timer = window.setInterval(() => setGone(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [whole])

  // A step about the whole screen shades nothing: with most of the window lit, a shade would only frame it.
  const litShare = (lit.boxes.reduce((sum, box) => sum + box.width * box.height, 0) + (lit.moon ? Math.PI * lit.moon.r ** 2 : 0)) / (window.innerWidth * window.innerHeight)
  const shaded = (lit.boxes.length > 0 || lit.moon !== null) && litShare < WHOLE_SCREEN

  return (
    <>
      {/* The page, shaded a little except what the step is about. It takes no clicks: the screen under it still works. */}
      <svg className={shaded ? 'sl-tour-shade' : 'sl-tour-shade is-off'} aria-hidden="true" width="100%" height="100%" data-lit={litShare.toFixed(2)}>
        <defs>
          <mask id="sl-tour-lit">
            <rect width="100%" height="100%" fill="white" />
            {lit.boxes.map((box, i) => (
              <rect key={i} x={box.left} y={box.top} width={Math.max(box.width, 0)} height={Math.max(box.height, 0)} rx={LIT_RADIUS_PX} fill="black" />
            ))}
            {lit.moon && <circle cx={lit.moon.x} cy={lit.moon.y} r={lit.moon.r + RING_AIR_PX} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#sl-tour-lit)" />
      </svg>
      {/* A ring round each thing the step is about, drawn where its lit part is, so the two move as one. */}
      {rings.map((ring, i) => (
        <div key={i} className="sl-tour-ring" style={lit.boxes[i] ?? ring} aria-hidden="true" />
      ))}
      <section ref={bubble} className="sl-tour" role="dialog" aria-label={name} data-step={step.id} data-pressed={step.press ? String(pressed) : undefined} style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}>
        <header className="sl-tour-head">
          <Mascot state={state} size={30} />
          <div className="sl-tour-heading">
            <p className="sl-tour-meta">
              <span className="sl-tour-count">
                {at + 1} of {steps.length}
              </span>
              {whole !== null && (
                <span className="sl-tour-clock" title="The time gone since the tour began, and the time it takes played through with the voice.">
                  {clockWords(gone)} of {clockWords(whole)}
                </span>
              )}
            </p>
            <h2 className="sl-tour-title">{step.title}</h2>
          </div>
        </header>
        <p className={step.line ? 'sl-tour-say' : 'sl-tour-say is-long'} aria-live="polite">
          {step.line ?? step.say}
        </p>
        {tryIt && (
          <button type="button" className="sl-link sl-tour-try" onClick={tryIt.onPick}>
            {tryIt.label} <span aria-hidden="true">›</span>
          </button>
        )}
        {/* A dot a step: where the tour is, and a way to any step. */}
        <ol className="sl-tour-dots" aria-label="Steps">
          {steps.map((one, i) => (
            <li key={one.id}>
              <button type="button" className={i === at ? 'is-here' : i < at ? 'is-seen' : undefined} aria-label={`Step ${i + 1}: ${one.title}`} aria-current={i === at ? 'step' : undefined} onClick={() => go(i)} />
            </li>
          ))}
        </ol>
        <footer className="sl-tour-foot">
          {voice && (
            <span className="sl-tour-voice">
              <button
                type="button"
                className="sl-small sl-tour-listen"
                aria-pressed={listen}
                title="Plays Scout's voice for each step. The voice is AI-generated; the words stay on screen."
                onClick={() => {
                  if (listen) setThrough(false)
                  setListen(!listen)
                }}
              >
                Listen
              </button>
              <button
                type="button"
                className="sl-small sl-tour-through"
                aria-pressed={through}
                title="Plays each step's voice in turn and moves on by itself when a line ends."
                onClick={() => {
                  if (!through) setListen(true)
                  setThrough(!through)
                }}
              >
                Play through
              </button>
              <small>{voice.voice.disclosure}</small>
            </span>
          )}
          <span className="sl-tour-nav">
            {last && onVideo && (
              <button type="button" className="sl-link sl-tour-video" onClick={onVideo}>
                Watch the walkthrough
              </button>
            )}
            <button type="button" className="sl-small" disabled={at === 0} onClick={() => go(at - 1)}>
              Back
            </button>
            <button ref={next} type="button" className="sl-small sl-tour-next" onClick={forward}>
              {waiting ? 'Show it' : last ? finish : 'Next'}
            </button>
            <button type="button" className="sl-small sl-tour-close" title="Leaves the tour and puts the screen back as you had it." onClick={onClose}>
              Close the tour
            </button>
          </span>
        </footer>
      </section>
    </>
  )
}
