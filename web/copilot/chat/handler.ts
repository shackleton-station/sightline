import { ASK_MAX_CHARS } from '../../src/lib/ask'
import { briefly, type QuestionEvent, questionAttributes } from '../../shared/events'
import { currentTraceId, currentTraceparent, span } from '../../shared/trace'
import { originAllowed, reply, visitorOf } from '../../shared/http'
import { createHash, randomUUID } from 'node:crypto'
import type { Relay } from '../outbox'
import { singleFlight } from '../../shared/singleFlight'
import type { Cache, Counts, Limiter, Locks } from '../../shared/store'
import type { CopilotDeps } from '../deps'
import { busyReply, countIfAllowed, MODEL_BUSY_WAIT_MS, retryHeaders, saysLongerThan, waitSeconds } from '../busy'
import { type ModelGuard, modelGuard } from '../modelCall'
import { parseCustomSite } from '../../src/lib/urlState'
import { viewFrom } from './actions'
import { CHAT_DEADLINE_MS, type ChatTurn, runChat } from './chat'
import type { SiteData } from '../../shared/tools/data'

/**
 * What makes "one recompute per key" work (shared/singleFlight.ts), all optional: without `locks`
 * every request that misses works its answer out, as before.
 */
export interface FlightDeps {
  /** Locks every copy of every service sees: the store's, on Redis. */
  locks?: Locks
  /** Shared counters, to record what each request did (`flight:copilot:led` and so on). */
  counts?: Counts
  /** Pauses between looks while waiting, and their spread. Tests pass a fake clock and fixed numbers. */
  wait?: (ms: number) => Promise<void>
  random?: () => number
}

/** What a streamed question is told while it waits for another request's answer to the same question. */
export const WAITING_STEP = 'The same question was asked a moment ago: waiting for its answer'

export interface ChatLimits {
  /** Per visitor, per minute. */
  each: Limiter
  /** Per visitor, per day. */
  eachDay: Limiter
  /** Everyone together, per minute and per day: the ceiling on what the model can cost. */
  all: Limiter
  allDay: Limiter
}

/** The last few turns are enough to follow a conversation, and keep each request small. */
const MAX_TURNS = 12
const MAX_ASSISTANT_CHARS = 1500
const MAX_BODY_CHARS = 30_000

/** A tapped spot as the Atlas sends it, "lat,lon" in degrees; null for anything else. */
function readSpot(value: unknown): { lat: number; lon: number } | null {
  return typeof value === 'string' && value.length <= 40 ? parseCustomSite(value) : null
}

/** The conversation, the visitor's view and any spot they tapped, or null if the request isn't shaped as the app sends it. */
function readBody(text: string): { turns: ChatTurn[]; view: unknown; spot: { lat: number; lon: number } | null } | null {
  if (text.length > MAX_BODY_CHARS) return null
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { messages, view, spot } = body as { messages?: unknown; view?: unknown; spot?: unknown }
  if (!Array.isArray(messages) || messages.length === 0) return null

  const turns: ChatTurn[] = []
  for (const message of messages.slice(-MAX_TURNS)) {
    const { role, text: said } = (message ?? {}) as { role?: unknown; text?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof said !== 'string') return null
    const trimmed = said.trim()
    if (trimmed.length === 0) return null
    if (role === 'user' && trimmed.length > ASK_MAX_CHARS) return null
    turns.push({ role, text: trimmed.slice(0, MAX_ASSISTANT_CHARS) })
  }
  return turns.at(-1)?.role === 'user' ? { turns, view, spot: readSpot(spot) } : null
}

/** How long an answer is reused. Its key names the code and the data it was worked out with, so a day is only a ceiling on memory. */
const ANSWER_TTL_S = 24 * 60 * 60

/** What a kept answer looked up, for the question log. */
function keptLookups(kept: string): string[] {
  return (JSON.parse(kept) as { reply?: { sources?: string[] } }).reply?.sources ?? []
}

/**
 * The cache key for a first question: the same words about the same view and tapped spot, answered
 * by the same co-pilot code from the same data. `answers` names those two (see `answerVersion`).
 *
 * It used to name the deploy (Cloud Run's revision), which emptied the cache on every deploy of the
 * site, including deploys that changed nothing the co-pilot uses, and could not be shared by two
 * services. Naming the code and the data instead means an answer never outlives the data it was
 * worked out from, and a deploy that changes neither keeps the answers.
 * Stored as `clps:cache:copilot:<hash>`: the service's name in the key, as voice's are `speak:`.
 */
export function answerKey(answers: string, question: string, view: unknown, spot: { lat: number; lon: number } | null): string {
  const asked = question.toLowerCase().replace(/\s+/g, ' ').trim()
  const tapped = spot ? `${spot.lat},${spot.lon}` : ''
  return `copilot:${createHash('sha256').update(`${answers}\n${typeof view === 'string' ? view : ''}\n${tapped}\n${asked}`).digest('hex')}`
}

/**
 * What a kept answer depends on: the co-pilot's code (a hash of the files its handlers are built
 * from, `scripts/copilot-version.mjs`) and the site data (the data version, a hash of its files).
 * Two images built from the same code and data give the same value even when built from different
 * commits.
 */
export function answerVersion(code: string | null | undefined, data: string | null | undefined): string {
  return `code=${code ?? 'dev'};data=${data ?? 'dev'}`
}

/** The two moments of logging a question: `kept` once it is in the outbox, `sent` once the queue has it or the wait is over. Neither rejects. */
interface Logged {
  kept: Promise<unknown>
  sent: Promise<void>
}

/**
 * POST /api/chat: one message to the co-pilot, with the conversation so far and the visitor's view.
 * A request is read and checked before it is counted: a malformed one is a 400 and spends nothing,
 * even when a limit is full. The limits are counted before anything is sent to the model, and only
 * for a call they all allow, so a refused call (429) spends nothing either.
 *
 * Every 429 and 503 that means "not now" carries a `Retry-After` header, and the page waits that
 * long before it lets the visitor ask again (src/lib/chatClient.ts): over a rate limit (429, until
 * the oldest counted call leaves its window), the circuit breaker open (503, until its trial), and
 * the model out of capacity (429). `not-configured` is a 503 too, but it does not pass with time,
 * so it carries none.
 *
 * A first question whose answer is not kept is worked out by one request at a time: the others
 * wait briefly for that answer (`flight`, shared/singleFlight.ts).
 */
export async function handleChat(
  request: Request,
  deps: CopilotDeps,
  limits: ChatLimits,
  data: SiteData,
  cache: Cache,
  relay: Relay | null = null,
  guard: ModelGuard = modelGuard({ now: deps.now }),
  flight: FlightDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405)
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  // Read before anything is counted. A body that says it is far longer than any conversation is not read at all.
  if (saysLongerThan(request, MAX_BODY_CHARS * 4)) return reply({ error: 'bad-question' }, 400)
  const body = readBody(await request.text())
  if (!body) return reply({ error: 'bad-question' }, 400)
  if (!deps.model) return reply({ error: 'not-configured' }, 503)

  const visitor = visitorOf(request, deps.trustedProxies)
  const refused = await span('rate limits', () =>
    countIfAllowed([
      [limits.each, visitor],
      [limits.eachDay, visitor],
      [limits.all, 'all'],
      [limits.allDay, 'all'],
    ]),
  )
  if (refused !== null) return busyReply(429, refused)

  // The first question of a conversation depends only on its words and the view, so its answer can
  // be reused. Later ones depend on what was said before, and are always worked out afresh.
  const key = body.turns.length === 1 ? answerKey(deps.answerVersion ?? answerVersion(null, null), body.turns[0].text, body.view, body.spot) : null
  const kept = key ? await span('answer cache', () => cache.get(key)) : null
  const model = deps.model
  const started = deps.now?.() ?? Date.now()
  const view = viewFrom(body.view)

  /**
   * One event for the question log and the day's counts, and one line in the server's own log tied
   * to this request's trace.
   *
   * The event goes through the outbox (`../outbox.ts`), in two steps. `kept`: it is written to the
   * outbox, about a millisecond, and the answer waits for that, so no answer goes out whose event
   * exists only in this process. `sent`: it is published to the queue and removed from the outbox;
   * the response waits for that only briefly, after the answer has gone. If the publish fails or
   * is cut short, the event is still in the outbox and the relay sends it later.
   */
  const record = (outcome: QuestionEvent['outcome'], lookups: string[], cached = kept !== null, servedBy?: string): Logged => {
    const ms = (deps.now?.() ?? Date.now()) - started
    const event: QuestionEvent = {
      kind: 'copilot_question',
      // Made here, once. Every delivery of this event carries it, which is how a reader counts it once.
      id: randomUUID(),
      at: new Date(started).toISOString(),
      question: body.turns.at(-1)?.text ?? '',
      site: view.a.site,
      month: view.a.month,
      lookups,
      cached,
      ms,
      outcome,
    }
    // The trace travels with the event as a message attribute, so the worker's steps join this request's trace.
    const stored = relay ? span('outbox', () => relay.keep(event.id, { ...event }, questionAttributes(currentTraceparent()))).catch(() => null) : Promise.resolve(null)
    const sent = stored.then((entry) => (entry && relay ? span('question log', () => briefly(relay.send(entry))) : undefined))
    // With tracing on, one log line per question carries the trace's id, so the log and the trace open each other.
    // `servedBy` names the fallback model when the server-side fallback answered (the question event has no field for it).
    const traceId = currentTraceId()
    if (traceId) {
      const trace = process.env.GOOGLE_CLOUD_PROJECT ? { 'logging.googleapis.com/trace': `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${traceId}` } : {}
      console.log(JSON.stringify({ severity: 'INFO', message: `copilot ${outcome} in ${ms} ms`, outcome, ms, cached: event.cached, lookups: lookups.length, ...(servedBy ? { servedBy } : {}), ...trace }))
    } else if (servedBy) {
      console.log(`copilot ${outcome} in ${ms} ms, written by the fallback model ${servedBy}`)
    }
    return { kept: stored, sent }
  }

  interface Answer {
    status: number
    body: unknown
    retryAfterMs?: number
    logged: Logged
  }

  /** Works out the answer. `onStep` hears about each lookup as it happens. `deadline`: when the question's time is up, if not 25 s from now. */
  const answer = async (onStep?: (title: string) => void, deadline?: number): Promise<Answer> => {
    try {
      const outcome = await span('co-pilot', () => runChat({ turns: body.turns, view, spot: body.spot, viewHash: body.view }, { model, data, now: deps.now, guard, onStep, deadline, horizons: deps.horizons }))
      if (!outcome.ok) {
        if (outcome.why === 'failed') return { status: 502, body: { error: 'upstream' }, logged: record('error', []) }
        // Busy: the breaker refused (503, as long as it stays open) or the model was out of capacity (429).
        const wait = outcome.retryAfterMs ?? MODEL_BUSY_WAIT_MS
        return { status: outcome.why === 'circuit-open' ? 503 : 429, body: { error: 'busy', retryAfterSeconds: waitSeconds(wait) }, retryAfterMs: wait, logged: record('busy', []) }
      }
      // A refusal is its own outcome: not an error (the model answered) and not an answer. It is not kept either.
      const logged = record(outcome.refusal ? 'refused' : outcome.fellBack ? 'fallback' : 'answered', outcome.reply.sources, kept !== null, outcome.servedBy)
      // Only answers that looked something up are kept: a fallback or a refusal may do better next time.
      if (key && !outcome.refusal && outcome.reply.sources.length > 0) await cache.set(key, JSON.stringify({ reply: outcome.reply }), ANSWER_TTL_S)
      return { status: 200, body: { reply: outcome.reply }, logged }
    } catch (error) {
      console.error('chat failed', error)
      return { status: 502, body: { error: 'upstream' }, logged: record('error', []) }
    }
  }

  // A kept answer needs no model, so it is given even while the breaker is open. Otherwise, with the
  // breaker open there is no point starting: say so at once, before any stream begins, so the
  // answer can carry a status and a Retry-After header. Only a look: the trial is taken later, by
  // the model call itself. It is a question the visitor was asked to bring back, so it is logged as busy.
  if (!kept) {
    const breaker = await span('circuit breaker', () => guard.breaker.peek())
    if (breaker.retryAfterMs > 0) {
      const logged = record('busy', [])
      await logged.kept
      await logged.sent
      return busyReply(503, breaker.retryAfterMs, { 'x-cache': 'miss' })
    }
  }

  /**
   * The answer to a question that was not kept: worked out here, or, if another request is already
   * working out the same one, that request's answer once it is kept (shared/singleFlight.ts).
   *
   * Only a first question has a key, so only first questions share. A request that waited and then
   * has to work the answer out itself does it inside its own 25 s, counted from when it arrived.
   * While it waits, a streamed request is sent one `step` event saying so; nothing else is sent
   * until the answer.
   */
  const settle = async (onStep?: (title: string) => void): Promise<{ kept: string } | { result: Answer }> => {
    // No key (a later question) or no locks (no Redis): nothing to share, and no step in the trace.
    if (!key || !flight.locks) return { result: await answer(onStep) }
    const flown = await span('single flight', () =>
      singleFlight<Answer>({
        key,
        locks: flight.locks,
        read: () => (cache.fresh ? cache.fresh(key) : cache.get(key)),
        compute: (waitedMs) => answer(onStep, waitedMs > 0 ? started + CHAT_DEADLINE_MS : undefined),
        deadline: started + CHAT_DEADLINE_MS,
        now: deps.now,
        wait: flight.wait,
        random: flight.random,
        onWait: () => onStep?.(WAITING_STEP),
      }),
    )
    flight.counts?.add(`flight:copilot:${flown.how}`)
    return 'kept' in flown ? { kept: flown.kept } : { result: flown.value }
  }

  // A browser that asks for a stream is told about each lookup as it happens, then given the answer.
  // The answer itself still arrives whole: its numbers are only filled in once the draft is checked.
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    const encoder = new TextEncoder()
    const event = (name: string, payload: unknown) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // The event is kept (about a millisecond), then the answer goes out; the stream then stays open a moment for the publish.
        const settled = kept ? { kept } : await settle((title) => controller.enqueue(event('step', { title })))
        if ('kept' in settled) {
          const logged = record('answered', keptLookups(settled.kept), true)
          await logged.kept
          controller.enqueue(event('reply', JSON.parse(settled.kept)))
          await logged.sent
        } else {
          const { result } = settled
          await result.logged.kept
          // Headers have gone by now, so a stream's "busy" carries its wait in the event: `retryAfterSeconds`.
          controller.enqueue(event(result.status === 200 ? 'reply' : 'error', result.body))
          await result.logged.sent
        }
        controller.close()
      },
    })
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        // Nothing between here and the browser may hold the stream back or rewrite it.
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-cache': kept ? 'hit' : 'miss',
      },
    })
  }

  // Kept already, or kept by another request while this one waited for it: the same reply either way.
  const settled = kept ? { kept } : await settle()
  if ('kept' in settled) {
    await record('answered', keptLookups(settled.kept), true).sent
    return new Response(settled.kept, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-cache': 'hit' } })
  }
  const { result } = settled
  await result.logged.sent
  return reply(result.body, result.status, { 'x-cache': 'miss', ...(result.retryAfterMs !== undefined ? retryHeaders(result.retryAfterMs) : {}) })
}
