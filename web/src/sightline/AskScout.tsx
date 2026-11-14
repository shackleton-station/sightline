import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { askCopilot, type ChatMessage, MAX_QUESTION_CHARS, stillWaitingText } from '../lib/chatClient'
import { copilotModel, readServices } from '../data/serviceStatus'
import { useCooldown } from '../lib/cooldown'
import type { RiverState } from '../lib/river'
import { Mascot } from '../scout/Mascot'
import { NOT_A_LOGIN } from './inputs'

/** The disclosure Space Apps asks for, as a small tag beside Scout's name; the Guide says it in full. */
export function AiTag() {
  return (
    <abbr className="sl-ai" title="Scout's answers and its mark are AI-generated. The Guide says more.">
      AI
    </abbr>
  )
}

/** The co-pilot's model as a name to read, asked for once for the whole page; a failed read is asked again next time. */
let modelRequest: Promise<string | null> | null = null
function readCopilotModel(): Promise<string | null> {
  modelRequest ??= fetch(`${import.meta.env.BASE_URL}api/status/services`)
    .then(async (response) => (response.ok ? readServices(await response.json()) : null))
    .then((services) => (services ? copilotModel({ state: 'ready', services }) : null))
    .catch(() => null)
    .then((name) => {
      if (name === null) modelRequest = null
      return name
    })
  return modelRequest
}

/**
 * The tag in the header of Scout's open card or panel: that he is AI, and which model, "AI · Claude
 * Opus 5.5". The name is read from the co-pilot's own status when the card opens, so it is never
 * out of date; if the status cannot be read, the tag says "AI" alone. His closed mark keeps the small
 * "AI" tag (`AiTag`).
 */
export function ModelTag() {
  const [model, setModel] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void readCopilotModel().then((name) => {
      if (current) setModel(name)
    })
    return () => {
      current = false
    }
  }, [])
  return (
    <abbr className="sl-ai sl-ai-model" title={`Scout's answers and its mark are AI-generated${model ? `: he is Anthropic's ${model}` : ''}. The Guide says more.`}>
      {model ? `AI · ${model}` : 'AI'}
    </abbr>
  )
}

/** One thing to try, offered beside the questions: its name, what picking it does, and what Scout says once it is done. */
export interface ScoutIdea {
  label: string
  done: string
  onPick: () => void
}

/** The conversation with Scout. It lives with the screen, not the panel, so closing the panel keeps it. */
export interface ScoutChat {
  thread: ChatMessage[]
  waiting: boolean
  /** What the co-pilot is looking up right now, while waiting for its answer. */
  step: string | null
  /** Send a question about the view given: the page's link, which says which scenario is on show. Resolves to whether it was answered. */
  ask: (question: string, view: string) => Promise<boolean>
  /** Put a line of Scout's own into the conversation (what an idea did). */
  say: (text: string) => void
}

/** The same co-pilot as the rest of the site. Each question goes with the page's link at that moment, so Scout knows the scenario on show. */
export function useScoutChat(): ScoutChat {
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  // A "busy" from the server says how long to wait (Retry-After); this counts it down.
  const cooldown = useCooldown()

  const ask = useCallback(
    (question: string, view: string) => {
      const text = question.trim().slice(0, MAX_QUESTION_CHARS)
      if (!text || waiting) return Promise.resolve(false)
      const said = thread.filter((message) => !message.failed)
      if (cooldown.secondsLeft > 0) {
        setThread([...said, { role: 'assistant', text: stillWaitingText(cooldown.secondsLeft), failed: true }])
        return Promise.resolve(false)
      }
      const next: ChatMessage[] = [...said, { role: 'user', text }]
      setThread(next)
      setWaiting(true)
      setStep(null)
      return askCopilot(next, view, setStep).then((answer) => {
        if (answer.retryAfterSeconds) cooldown.start(answer.retryAfterSeconds)
        setThread([...next, answer])
        setWaiting(false)
        return !answer.failed
      })
    },
    [thread, waiting, cooldown],
  )
  const say = useCallback((text: string) => setThread((before) => [...before, { role: 'assistant', text }]), [])
  return { thread, waiting, step, ask, say }
}

interface Props {
  chat: ScoutChat
  /** The app's link for what is on screen, with the scenario on show marked, so Scout answers about it. */
  view: string
  placeholder: string
  /** What is in view at the scenario's site at its landing, for Scout's mark; null while it loads. */
  state: RiverState | null
  /** Three questions to tap while there is no conversation yet, written for the scenario on show. */
  ideas: string[]
  idea?: ScoutIdea
  /** A button in an answer was pressed: go where its link points. */
  onOpen: (hash: string) => void
  onClose: () => void
  /** Start Scout's one-minute tour of the screen; whether it has been taken (until then its chip is outlined). */
  onTour: () => void
  tourTaken: boolean
}

/**
 * Scout's panel, on the right like Mission and Compare: the conversation down the screen's full
 * height, the one-minute tour and the input pinned at its foot, and, until something is said, ideas
 * to tap for the scenario on show.
 */
export function ScoutPanel({ chat, view, placeholder, state, ideas, idea, onOpen, onClose, onTour, tourTaken }: Props) {
  const [draft, setDraft] = useState('')
  const talk = useRef<HTMLDivElement>(null)
  const { thread, waiting, step } = chat
  // The newest line stays in sight as the conversation grows.
  useEffect(() => {
    const area = talk.current
    if (area) area.scrollTop = area.scrollHeight
  }, [thread.length, waiting])

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
    <aside className="sl-drawer sl-scout-panel" aria-label="Scout">
      <header className="sl-drawer-head">
        <h2 className="sl-ask-name">
          <Mascot state={state} size={20} /> Scout <ModelTag />
        </h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      <div ref={talk} className="sl-talk" aria-live="polite">
        {thread.length === 0 && !waiting && (
          <>
            <p className="sl-quiet">Ask about the scenario on show, or try one of these.</p>
            <ul className="sl-ideas" aria-label="Ideas to ask Scout">
              {ideas.map((question) => (
                <li key={question}>
                  <button type="button" className="sl-idea" onClick={() => void chat.ask(question, view)}>
                    {question}
                  </button>
                </li>
              ))}
              {idea && (
                <li>
                  <button
                    type="button"
                    className="sl-idea is-action"
                    onClick={() => {
                      chat.say(idea.done)
                      idea.onPick()
                    }}
                  >
                    {idea.label}
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
        {thread.map((message, i) => (
          <div key={i} className={message.role === 'user' ? 'sl-said is-visitor' : 'sl-said is-scout'}>
            <p className={message.failed ? 'is-warn' : undefined}>{message.text}</p>
            {message.actions?.map((action) => (
              <button key={action.hash + action.label} type="button" className="sl-small" onClick={() => onOpen(action.hash)}>
                {action.label}
              </button>
            ))}
          </div>
        ))}
        {waiting && (
          <div className="sl-said is-scout is-waiting">
            <p>{step ?? 'Looking that up…'}</p>
          </div>
        )}
      </div>
      <button type="button" className={tourTaken ? 'sl-tour-here' : 'sl-tour-here is-new'} title="Scout walks you through the screen, in about a minute" onClick={onTour}>
        <span aria-hidden="true">▶</span> One-minute tour
      </button>
      <form className="sl-ask" autoComplete="off" onSubmit={send}>
        <input type="text" id="sl-question" name="question" {...NOT_A_LOGIN} value={draft} maxLength={MAX_QUESTION_CHARS} placeholder={placeholder} aria-label="Ask Scout" onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="sl-small" disabled={waiting || !draft.trim()}>
          Ask
        </button>
      </form>
    </aside>
  )
}
