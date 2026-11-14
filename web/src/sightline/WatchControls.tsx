import type { RiverState } from '../lib/river'
import { DEFAULT_SPEED, SPEEDS } from '../lib/sightline'
import { Mascot } from '../scout/Mascot'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { MAX_QUESTION_CHARS } from '../lib/chatClient'
import { AiTag, ModelTag, type ScoutChat } from './AskScout'
import { NOT_A_LOGIN } from './inputs'
import type { Clock } from './hooks'

interface ScoutProps {
  /** Scout's one line: an invitation, or what is up at the site the pointer is on. */
  line: string
  /** What is in view at the site Scout is talking about; null when it is talking about none. */
  state: RiverState | null
  open: boolean
  onOpen: (open: boolean) => void
  /** The conversation, the same one as in Plan's Scout panel. */
  chat: ScoutChat
  /** The app's link for what Watch is showing, sent with each question. */
  view: string
  /** "Show me": put the time bar on the moment a reply names. */
  onShow: (hash: string) => void
  /** "Plan this": open Plan on the site or landing a reply names. */
  onPlan: (hash: string) => void
  /** How tall the open card is, so the Moon can move aside for it on a narrow screen; 0 when closed. */
  onHeight: (px: number) => void
  /**
   * On a first visit his closed line offers the tour instead of its usual words: a line to press,
   * which fades as his line does and is not offered again. Null once it has been seen or taken.
   */
  offer: { words: string; onTake: () => void; onGone: () => void } | null
}

/** How long Scout's line stays beside his mark before it fades to the mark alone. */
const LINE_SHOWS_MS = 8000

/** Three questions to tap before anything is asked, written for Watch. */
const WATCH_IDEAS = ['What am I looking at?', 'Which site has the most Sun this month?', 'Where can a lander see Earth right now?']

/**
 * Scout in Watch. Closed, he is his mark with one line beside it; the line is an invitation and fades
 * to the mark alone after a few seconds, or once the visitor does anything else, and comes back when
 * the mark is hovered or focused. His mark opens a compact chat card in the empty sky at the lower
 * left, and closes it; it never leaves Watch. A reply that names a place carries "Show me" and "Plan
 * this", the only things in a reply that change the screen, and only when pressed.
 */
export function ScoutLine({ line, state, open, onOpen, chat, view, onShow, onPlan, onHeight, offer }: ScoutProps) {
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<string | null>(line)
  const card = useRef<HTMLDivElement>(null)
  const talk = useRef<HTMLDivElement>(null)
  const { thread, waiting, step } = chat
  // The tour's offer stands in for his first line only: once that has faded, or he has something
  // else to say (a site under the pointer), the line is his own again.
  const [offering, setOffering] = useState(offer !== null)
  const firstLine = useRef(line)
  const offered = offering && offer !== null && line === firstLine.current
  useEffect(() => {
    if (said !== null || !offering) return
    setOffering(false)
    offer?.onGone()
  }, [said, offering, offer])

  // The line shows when it is new (or the mark is hovered or focused), then fades after a while or once the visitor does anything else.
  useEffect(() => {
    setSaid(line)
    const timer = window.setTimeout(() => setSaid(null), LINE_SHOWS_MS)
    const elsewhere = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest('.sl-scout'))) setSaid(null)
    }
    window.addEventListener('pointerdown', elsewhere)
    window.addEventListener('keydown', elsewhere)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', elsewhere)
      window.removeEventListener('keydown', elsewhere)
    }
  }, [line])

  // The card's height, for the Moon to move aside; Escape closes it; the newest line stays in sight.
  useEffect(() => {
    const el = card.current
    if (!open || !el) {
      onHeight(0)
      return
    }
    const watcher = new ResizeObserver(() => onHeight(el.offsetHeight))
    watcher.observe(el)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      watcher.disconnect()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onHeight, onOpen])
  useEffect(() => {
    const area = talk.current
    if (area) area.scrollTop = area.scrollHeight
  }, [thread.length, waiting, open])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const text = draft
    if (!text.trim() || waiting) return
    setDraft('')
    // A question that could not be answered goes back into the input, so nothing typed is lost.
    void chat.ask(text, view).then((answered) => {
      if (!answered) setDraft((now) => now || text)
    })
  }

  return (
    <div className={open ? 'sl-scout is-open' : 'sl-scout sl-fade'}>
      <button
        type="button"
        className="scout-face"
        aria-expanded={open}
        aria-label={open ? 'Close Scout' : 'Ask Scout'}
        onClick={() => onOpen(!open)}
        onMouseEnter={() => setSaid(line)}
        onFocus={() => setSaid(line)}
      >
        <Mascot state={state} size={44} pulse={line} />
      </button>
      {/* The disclosure stays with his mark while he is closed; open, it is in the card's header. */}
      {!open && (
        <span className="sl-scout-tag">
          <AiTag />
        </span>
      )}
      {!open && (
        <p className={said ? 'sl-scout-line' : 'sl-scout-line is-gone'} role="status">
          {offered ? (
            <button type="button" className="sl-tour-offer" onClick={offer.onTake}>
              {offer.words}
            </button>
          ) : (
            line
          )}
        </p>
      )}
      {open && (
        <div ref={card} className="sl-card" role="dialog" aria-label="Scout">
          <header className="sl-card-head">
            <span className="sl-ask-name">
              Scout <ModelTag />
            </span>
            <button type="button" className="sl-small" onClick={() => onOpen(false)}>
              Close
            </button>
          </header>
          <div ref={talk} className="sl-talk" aria-live="polite">
            {thread.length === 0 && !waiting && (
              <ul className="sl-ideas" aria-label="Ideas to ask Scout">
                {WATCH_IDEAS.map((question) => (
                  <li key={question}>
                    <button type="button" className="sl-idea" onClick={() => void chat.ask(question, view)}>
                      {question}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {thread.map((message, i) => {
              const place = message.role === 'assistant' && !message.failed ? (message.actions?.[0] ?? null) : null
              return (
                <div key={i} className={message.role === 'user' ? 'sl-said is-visitor' : 'sl-said is-scout'}>
                  <p className={message.failed ? 'is-warn' : undefined}>{message.text}</p>
                  {place && (
                    <>
                      <button type="button" className="sl-small" title={`Put the time bar on ${place.label}`} onClick={() => onShow(place.hash)}>
                        Show me
                      </button>
                      <button type="button" className="sl-small" title={`Open the planner on ${place.label}`} onClick={() => onPlan(place.hash)}>
                        Plan this
                      </button>
                    </>
                  )}
                </div>
              )
            })}
            {waiting && (
              <div className="sl-said is-scout is-waiting">
                <p>{step ?? 'Thinking…'}</p>
              </div>
            )}
          </div>
          <form className="sl-ask" autoComplete="off" onSubmit={send}>
            <input type="text" id="sl-watch-question" name="question" {...NOT_A_LOGIN} value={draft} maxLength={MAX_QUESTION_CHARS} placeholder="Ask Scout" aria-label="Ask Scout" onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" className="sl-small" disabled={waiting || !draft.trim()}>
              Ask
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

interface PlayProps {
  clock: Clock
  /** The date on the clock, "13 May 2027". */
  date: string
  /** The clock hours the scrub line covers: the calendar month on show. */
  span: { from: number; to: number }
  minimised: boolean
  onMinimise: (minimised: boolean) => void
}

/** The small play control at the bottom: play or pause, the date, the speed and a scrub line. Shrinks to a dot. */
export function PlayControl({ clock, date, span, minimised, onMinimise }: PlayProps) {
  const play = (
    <button type="button" className="sl-round" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => clock.setPlaying(!clock.playing)}>
      {clock.playing ? '❚❚' : '▶'}
    </button>
  )
  if (minimised) {
    return (
      <div className="sl-pill sl-fade is-min">
        <button type="button" className="sl-round" aria-label={`Show the date control. ${date}`} title={date} onClick={() => onMinimise(false)}>
          {clock.playing ? '▶' : '❚❚'}
        </button>
      </div>
    )
  }
  return (
    <div className="sl-pill sl-fade" role="group" aria-label="Time">
      {play}
      <output className="sl-date">{date}</output>
      <select
        className="sl-wide"
        aria-label="Speed"
        value={SPEEDS.some((speed) => speed.hoursPerSecond === clock.hoursPerSecond) ? clock.hoursPerSecond : DEFAULT_SPEED}
        onChange={(event) => clock.setSpeed(Number(event.target.value))}
      >
        {SPEEDS.map((speed) => (
          <option key={speed.hoursPerSecond} value={speed.hoursPerSecond}>
            {speed.label}
          </option>
        ))}
      </select>
      <input
        className="sl-wide"
        type="range"
        aria-label="Move through the month"
        aria-valuetext={date}
        min={span.from}
        max={span.to - 1}
        step={1}
        value={Math.floor(clock.hour)}
        onChange={(event) => clock.setHour(Number(event.target.value))}
      />
      <button type="button" className="sl-round" aria-label="Minimise the date control" onClick={() => onMinimise(true)}>
        –
      </button>
    </div>
  )
}
