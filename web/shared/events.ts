/**
 * Things worth knowing afterwards, such as which questions people ask the co-pilot. The server
 * hands each one to a queue (Pub/Sub). Two readers each get every message: a table (BigQuery) that
 * keeps the question log, and the `events-worker` service, which keeps the day's counts. A slow or
 * broken reader never breaks an answer.
 *
 * This file is the contract between the service that publishes and the ones that read: the event's
 * shape, the message attributes that travel with it, and the one function both sides use to read it.
 */

/** How a publish ended. `retry`: not accepted this time, try again. `refused`: it never will be. */
export type PublishResult = 'sent' | 'retry' | 'refused'

export interface EventSink {
  /**
   * Sends one event, with attributes that travel beside it. It never rejects: the result says what
   * happened. A sink that resolves to nothing means "sent" (the simplest fake in a test).
   */
  publish(event: Record<string, unknown>, attributes?: Record<string, string>): Promise<PublishResult | void> | PublishResult | void
}

/**
 * Waits for a send to finish, but only briefly. Cloud Run gives a server CPU only while it is
 * answering a request, so a send left running after the response may stall until the next visitor.
 * Waiting a moment before the response ends lets nearly every send finish; one that is slow is
 * left to its luck rather than holding up the visitor.
 */
export function briefly(sending: Promise<unknown> | void, ms = 250): Promise<void> {
  if (!sending) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void sending.finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export const QUESTION_KIND = 'copilot_question'
/**
 * How a question ended. `refused`, added with the move to Claude (docs/decisions/0009-copilot-on-claude.md):
 * the model declined the question (`stop_reason: "refusal"`), after the server-side fallback had its go.
 * Added at the end, never renamed: readers deployed apart ignore what they do not count.
 */
export const OUTCOMES = ['answered', 'fallback', 'busy', 'error', 'refused'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** What is recorded about a co-pilot question. Deliberately nothing about who asked. */
export interface QuestionEvent {
  kind: typeof QUESTION_KIND
  /**
   * The event's own name, made once when the question is answered. The same event can reach a
   * reader more than once (the queue delivers at least once, and so does the outbox behind it), and
   * each delivery through the queue gets a new message id. This id is what stays the same, so it is
   * what a reader uses to count an event once.
   */
  id: string
  at: string
  question: string
  site: string
  month: string
  /** What was looked up to answer. */
  lookups: string[]
  cached: boolean
  ms: number
  outcome: Outcome
}

/** The attribute that says what kind of event a message carries, so a reader need not open it to know. */
export const KIND_ATTRIBUTE = 'kind'
/** The attribute that carries the publisher's trace (W3C `traceparent`), so the reader's steps join the same trace. */
export const TRACE_ATTRIBUTE = 'traceparent'

/** The attributes a question event is published with. */
export function questionAttributes(traceparent: string | null): Record<string, string> {
  return { [KIND_ATTRIBUTE]: QUESTION_KIND, ...(traceparent ? { [TRACE_ATTRIBUTE]: traceparent } : {}) }
}

/** An id is used as a document name by the worker, so it is kept to letters, digits, `-` and `_`. */
const ID = /^[A-Za-z0-9_-]{1,64}$/

/** The part of a question event a counter needs. Never the question's words. */
export interface CountableQuestion {
  /** The key to count this event once by: the event's own id, or the queue's message id for an event published without one. */
  key: string
  /** The UTC day the question was asked, `YYYY-MM-DD`. */
  day: string
  cached: boolean
  outcome: Outcome
}

export type ReadEvent = { is: 'question'; question: CountableQuestion } | { is: 'other'; kind: string } | { is: 'malformed'; why: string }

/**
 * Reads an event as a counter needs it. Tolerant on purpose, so the publisher and the reader can
 * be deployed apart: fields it does not know are ignored, an event of another kind is `other` (not
 * an error), and an event from a publisher too old to send an id falls back to the queue's message
 * id. `malformed` is only for a question event that cannot be counted at all.
 */
export function readEvent(event: unknown, messageId: string | null): ReadEvent {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return { is: 'malformed', why: 'not an object' }
  const { kind, id, at, cached, outcome } = event as Record<string, unknown>
  if (typeof kind !== 'string' || kind === '') return { is: 'malformed', why: 'no kind' }
  if (kind !== QUESTION_KIND) return { is: 'other', kind }

  const when = typeof at === 'string' ? Date.parse(at) : Number.NaN
  if (Number.isNaN(when)) return { is: 'malformed', why: 'no time' }
  if (typeof cached !== 'boolean') return { is: 'malformed', why: 'cached is not true or false' }
  if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) return { is: 'malformed', why: 'unknown outcome' }

  // Two namespaces, so an event id can never be mistaken for a message id.
  let key: string
  if (id === undefined || id === null) {
    if (!messageId || !ID.test(messageId)) return { is: 'malformed', why: 'no id' }
    key = `m-${messageId}`
  } else if (typeof id === 'string' && ID.test(id)) {
    key = `e-${id}`
  } else {
    return { is: 'malformed', why: 'bad id' }
  }
  return { is: 'question', question: { key, day: new Date(when).toISOString().slice(0, 10), cached, outcome: outcome as Outcome } }
}

/** A message as Pub/Sub pushes it: the event is base64 JSON in `data`. */
export interface PushedMessage {
  data: unknown
  attributes: Record<string, string>
  messageId: string | null
  /** How many times Pub/Sub has tried this message; present once the subscription has a dead-letter topic. */
  deliveryAttempt: number | null
}

/** The body of a Pub/Sub push request, or null if it isn't shaped like one. */
export function readPush(body: string): PushedMessage | null {
  let envelope: unknown
  try {
    envelope = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof envelope !== 'object' || envelope === null) return null
  const { message, deliveryAttempt } = envelope as { message?: unknown; deliveryAttempt?: unknown }
  if (typeof message !== 'object' || message === null) return null
  const { data, attributes, messageId, message_id } = message as { data?: unknown; attributes?: unknown; messageId?: unknown; message_id?: unknown }
  if (typeof data !== 'string') return null
  let event: unknown
  try {
    event = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
  } catch {
    return null
  }
  const id = typeof messageId === 'string' ? messageId : typeof message_id === 'string' ? message_id : null
  const named: Record<string, string> = {}
  if (typeof attributes === 'object' && attributes !== null) {
    for (const [name, value] of Object.entries(attributes)) if (typeof value === 'string') named[name] = value
  }
  return { data: event, attributes: named, messageId: id, deliveryAttempt: typeof deliveryAttempt === 'number' ? deliveryAttempt : null }
}

/** The body Pub/Sub would push for an event. Used by tests, the local stand-in for the queue, and the sample script. */
export function pushBody(event: Record<string, unknown>, attributes: Record<string, string>, messageId: string, deliveryAttempt?: number): string {
  return JSON.stringify({
    ...(deliveryAttempt ? { deliveryAttempt } : {}),
    message: { data: Buffer.from(JSON.stringify(event)).toString('base64'), attributes, messageId, publishTime: new Date().toISOString() },
    subscription: 'local',
  })
}
