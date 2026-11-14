import { browserHeader } from './browserId'

/** One thing said in the co-pilot's thread. Answers carry the buttons, sources and follow-ups the server sent. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  actions?: { label: string; hash: string }[]
  sources?: string[]
  followups?: string[]
  /** An answer that is really a failure notice; it isn't sent back as conversation. */
  failed?: boolean
  /** On a "busy" failure: how many seconds to wait before asking again, as the server said (Retry-After). */
  retryAfterSeconds?: number
}

/** As many turns as the server reads, and as many characters as it accepts from a visitor. */
export const MAX_TURNS = 10
export const MAX_QUESTION_CHARS = 400

/** Ground the visitor tapped on the Atlas map, which the co-pilot can look up as well as the listed sites. */
export interface TappedSpot {
  lat: number
  lon: number
}

/**
 * What goes to the server: the last few turns as plain text, ending with the visitor's message, the
 * view on screen and, on the Atlas, the spot that was tapped.
 */
export function toRequest(thread: ChatMessage[], view: string, spot: TappedSpot | null = null): { messages: { role: string; text: string }[]; view: string; spot?: string } {
  const messages = thread
    .filter((message) => !message.failed)
    .slice(-MAX_TURNS)
    .map(({ role, text }) => ({ role, text }))
  return spot ? { messages, view, spot: `${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}` } : { messages, view }
}

/**
 * When the server says "busy" without saying for how long. The load balancer's own refusals carry no
 * Retry-After header, nor do pages from servers older than the header.
 */
export const DEFAULT_WAIT_SECONDS = 15
/** Longer than this, the page says "later" rather than counting seconds (a daily limit, say). */
const LONGEST_COUNTDOWN_S = 300

/**
 * How long the server asked the page to wait, in whole seconds: the Retry-After header (seconds or a
 * date), or `retryAfterSeconds` in the body (a stream's busy event has no headers of its own). Null
 * if neither says.
 */
export function retryAfterSeconds(header: string | null, body: unknown, now: number = Date.now()): number | null {
  const fromBody = (body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds
  if (header) {
    const trimmed = header.trim()
    if (/^\d+$/.test(trimmed)) return Math.max(1, Number(trimmed))
    const when = Date.parse(trimmed)
    if (!Number.isNaN(when)) return Math.max(1, Math.ceil((when - now) / 1000))
  }
  return typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody > 0 ? Math.ceil(fromBody) : null
}

/** "in 20 s", "in 2 min", or "later" past five minutes. */
export function waitWords(seconds: number): string {
  if (seconds > LONGEST_COUNTDOWN_S) return 'later'
  return seconds < 90 ? `in ${seconds} s` : `in ${Math.round(seconds / 60)} min`
}

/** What to tell the visitor when the server can't answer, by the name every page knows the assistant by: Scout. `waitS`: how long it asked us to wait, for a busy answer. */
export function failureText(status: number, waitS: number | null = null, error?: string): string {
  if (status === 503 && error === 'not-configured') return "Scout isn't switched on here."
  if (status === 429 || status === 503) return `Scout is busy. Ask again ${waitWords(waitS ?? DEFAULT_WAIT_SECONDS)}.`
  if (status === 400) return "I couldn't read that question. Try a shorter one."
  return "Something went wrong on our side. Your question wasn't lost: try sending it again."
}

/** What to say when the visitor asks while the page is still waiting out a "busy". Nothing is sent. */
export function stillWaitingText(secondsLeft: number): string {
  return `Scout is still busy. Ask again ${waitWords(secondsLeft)}.`
}

/** A failure notice, with the wait to obey when it is a "busy" one. */
function failure(status: number, waitS: number | null, error?: string): ChatMessage {
  const busy = (status === 429 || status === 503) && error !== 'not-configured'
  return { role: 'assistant', text: failureText(status, waitS, error), failed: true, ...(busy ? { retryAfterSeconds: waitS ?? DEFAULT_WAIT_SECONDS } : {}) }
}

/** A reply from the server, or null if it isn't shaped like one. */
export function readReply(body: unknown): ChatMessage | null {
  const reply = (body as { reply?: unknown } | null)?.reply as Partial<ChatMessage> | undefined
  if (!reply || typeof reply.text !== 'string' || reply.text.trim() === '') return null
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  const actions = Array.isArray(reply.actions)
    ? reply.actions.filter(
        (action): action is { label: string; hash: string } =>
          typeof action?.label === 'string' && typeof action?.hash === 'string' && action.hash.startsWith('#a='),
      )
    : []
  return { role: 'assistant', text: reply.text, actions, sources: strings(reply.sources), followups: strings(reply.followups) }
}

/** Questions to start from, about the place on screen. */
export function starterQuestions(siteName: string, monthLabel: string, plan: boolean): string[] {
  return plan
    ? [
        `When can I land at ${siteName} in ${monthLabel}?`,
        'My landing slipped by a month. Does it still work?',
        `Which site has the most landing days in ${monthLabel}?`,
        'What if my mission were only a week long?',
      ]
    : [
        `How sunny is ${siteName} in ${monthLabel}?`,
        'Is Earth in view right now?',
        `Which site gets the most Sun in ${monthLabel}?`,
        `How does ${siteName} compare with Apollo 11?`,
      ]
}

const STORE_KEY = 'copilot-thread'

/** The thread from earlier in this tab, if the browser kept it. */
export function loadThread(): ChatMessage[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(saved) ? (saved as ChatMessage[]).filter((item) => typeof item?.text === 'string') : []
  } catch {
    return []
  }
}

export function saveThread(thread: ChatMessage[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(thread.slice(-2 * MAX_TURNS)))
  } catch {
    // Private windows and full storage: the chat still works, it just isn't remembered.
  }
}

/** One server-sent event: its name and its JSON payload. */
export interface StreamEvent {
  name: string
  data: unknown
}

/**
 * Splits what has arrived of an event stream into whole events and the unfinished rest.
 * Events end with a blank line; each has an "event:" line and a "data:" line of JSON.
 */
export function readEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events = blocks.flatMap((block): StreamEvent[] => {
    const name = /^event: (.*)$/m.exec(block)?.[1]
    const data = /^data: (.*)$/m.exec(block)?.[1]
    if (!name || data === undefined) return []
    try {
      return [{ name, data: JSON.parse(data) }]
    } catch {
      return []
    }
  })
  return { events, rest }
}

/**
 * Asks the co-pilot, hearing about each lookup as it happens. Resolves with the answer, or with a
 * failure notice worded for the visitor. Works the same if the server answers in one piece.
 */
export async function askCopilot(thread: ChatMessage[], view: string, onStep: (title: string) => void, spot: TappedSpot | null = null): Promise<ChatMessage> {
  const failed = (text: string): ChatMessage => ({ role: 'assistant', text, failed: true })
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...browserHeader() },
      body: JSON.stringify(toRequest(thread, view, spot)),
    })
    if (!response.ok) {
      // The body may be JSON from the server, or plain text from the load balancer.
      const body: unknown = await response.json().catch(() => null)
      const error = (body as { error?: unknown } | null)?.error
      return failure(response.status, retryAfterSeconds(response.headers.get('retry-after'), body), typeof error === 'string' ? error : undefined)
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      return readReply(await response.json()) ?? failed(failureText(502))
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const read = readEvents(buffer + value)
      buffer = read.rest
      for (const event of read.events) {
        if (event.name === 'step') onStep(String((event.data as { title?: unknown })?.title ?? ''))
        if (event.name === 'reply') return readReply(event.data) ?? failed(failureText(502))
        if (event.name === 'error') return (event.data as { error?: string })?.error === 'busy' ? failure(429, retryAfterSeconds(null, event.data)) : failed(failureText(502))
      }
    }
    return failed(failureText(502))
  } catch {
    return failed("I couldn't reach the server. Check your connection and ask again.")
  }
}
