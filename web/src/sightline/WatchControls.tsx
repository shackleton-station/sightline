import type { RiverState } from '../lib/river'
import { DEFAULT_SPEED, SPEEDS, TIME_KEYS_MEAN } from '../lib/sightline'
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
  /** One thing to try, offered under the questions: it opens a ready comparison instead of asking anything. Null when it cannot be shown. */
  idea: { label: string; onPick: () => void } | null
  /**
   * The latest reply leads with sites that cannot be seen where the Moon is turned: one button under
   * it turns the Moon to the first of them, "Show Apollo 11 on the Moon". Null when they can be seen.
   */
  turn: { label: string; onPress: () => void } | null
}

/** How long Scout's line stays beside his mark before it fades to the mark alone. */
const LINE_SHOWS_MS = 8000

/** What Scout says in his open card before anything is asked. */
const HELLO = 'I’m Scout. Ask me where a lander could set down and when: I look the answer up in the same data this Moon is drawn from.'

/** Three questions to tap before anything is asked, written for Watch. */
const WATCH_IDEAS = ['What am I looking at?', 'Which site has the most Sun this month?', 'Where can a lander see Earth right now?']

/**
 * Scout in Watch. Closed, he is his mark with one line beside it; the line is an invitation and fades
 * to the mark alone after a few seconds, or once the visitor does anything else, and comes back when
 * the mark is hovered or focused. His mark opens his chat card and closes it; it never leaves Watch.
 * The card stands down the far right edge of the window, where his panel stands in Plan (on a phone
 * it is a sheet across the bottom). A reply that names a place carries "Show me" and "Plan
 * this", the only things in a reply that change the screen, and only when pressed.
 */
export function ScoutLine({ line, state, open, onOpen, chat, view, onShow, onPlan, onHeight, idea, turn }: ScoutProps) {
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<string | null>(line)
  const card = useRef<HTMLDivElement>(null)
  const talk = useRef<HTMLDivElement>(null)
  const { thread, waiting, step } = chat

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
    <div className={open ? 'sl-scout is-open' : 'sl-scout'}>
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
          {line}
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
              <div className="sl-said is-scout sl-hello">
                <p>{HELLO}</p>
              </div>
            )}
            {thread.length === 0 && !waiting && (
              <ul className="sl-ideas" aria-label="Ideas to ask Scout">
                {WATCH_IDEAS.map((question) => (
                  <li key={question}>
                    <button type="button" className="sl-idea" onClick={() => void chat.ask(question, view)}>
                      {question}
                    </button>
                  </li>
                ))}
                {idea && (
                  <li>
                    <button type="button" className="sl-idea is-action" onClick={idea.onPick}>
                      {idea.label} <span aria-hidden="true">›</span>
                    </button>
                  </li>
                )}
              </ul>
            )}
            {thread.map((message, i) => {
              const place = message.role === 'assistant' && !message.failed ? (message.actions?.[0] ?? null) : null
              return (
                <div key={i} className={message.role === 'user' ? 'sl-said is-visitor' : 'sl-said is-scout'}>
                  <p className={message.failed ? 'is-warn' : undefined}>{message.text}</p>
                  {place && (
                    <>
                      <button type="button" className="sl-small" title={`Moves the time bar to ${place.label}.`} onClick={() => onShow(place.hash)}>
                        Show me
                      </button>
                      <button type="button" className="sl-small" title={`Opens the plan on ${place.label}.`} onClick={() => onPlan(place.hash)}>
                        Plan this
                      </button>
                    </>
                  )}
                  {/* The answer never turns the Moon by itself: where the sites it leads with are out of sight, one press shows them. */}
                  {turn && message.role === 'assistant' && i === thread.length - 1 && (
                    <button type="button" className="sl-small sl-show-on-moon" title="Turns the Moon to that site. The compass beside the Moon turns it back." onClick={turn.onPress}>
                      {turn.label}
                    </button>
                  )}
                  {/* The answer was about the present and the time bar is on another day: one press asks the same for the bar's date. */}
                  {message.ask && i === thread.length - 1 && (
                    <button type="button" className="sl-small sl-ask-again" disabled={waiting} onClick={() => void chat.ask(message.ask?.question ?? '', view)}>
                      {message.ask.label}
                    </button>
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
    <button type="button" className="sl-round" aria-label={clock.playing ? 'Pause' : 'Play'} title={TIME_KEYS_MEAN} onClick={() => clock.setPlaying(!clock.playing)}>
      {clock.playing ? '❚❚' : '▶'}
    </button>
  )
  if (minimised) {
    return (
      <div className="sl-pill is-min">
        <button type="button" className="sl-round" aria-label={`Show the date control. ${date}`} title={`Shows the date control. Now ${date}.`} onClick={() => onMinimise(false)}>
          {clock.playing ? '▶' : '❚❚'}
        </button>
      </div>
    )
  }
  return (
    <div className="sl-pill" role="group" aria-label="Time">
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
