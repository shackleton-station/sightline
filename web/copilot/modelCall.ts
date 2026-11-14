import Anthropic from '@anthropic-ai/sdk'
import { span } from '../shared/trace'
import { type Breaker, memoryBreaker } from './breaker'
import type { Model, ModelMessage, ModelRequest } from './model'

/**
 * One call to the model, with retries and the circuit breaker (copilot/breaker.ts) around it.
 * Both the co-pilot (chat/chat.ts) and the typed-question box (ask.ts) call the model through this.
 *
 * RETRIES. Shared capacity on the model's side comes and goes, so a failed call is often worth one
 * more try a moment later. Anthropic's error reference (REFERENCES.md) names what is worth retrying:
 * 429 (rate limited; fast mode has a limit of its own), 529 (overloaded), 5xx, and dropped or
 * timed-out connections; the SDK's own retries also cover 408 and 409. How: growing delays, with
 * jitter, and a cap on tries. This is the only retry policy: the SDK client's own retries are off
 * (claude.ts), so a call is never tried more often than this says. Here:
 *
 * - At most 3 tries in all. Each question already makes up to 5 model calls, and the visitor is
 *   waiting: more tries would mostly spend the request's time.
 * - Before try n+1, wait a random time between 0 and min(4 s, 0.5 s × 2^(n-1)): up to 0.5 s, then
 *   up to 1 s. "Full jitter": the whole wait is random, so copies that failed at the same moment do
 *   not all come back at the same moment.
 * - If the API said when to come back (a Retry-After header, as it sends with a 429), wait at least that long.
 * - Never retry past the request's own deadline: a try only starts if, after its wait, at least
 *   2 s are left for it.
 * - Never retry anything else: a 400 is our request's fault and would fail the same way again, and
 *   a 401 or 403 is a key that is wrong or missing.
 * - The breaker's one trial is not retried: it is the one question that tests the model.
 * - A refusal is not a failure. It comes back as an ordinary answer (HTTP 200, `stop_reason:
 *   "refusal"`), after the server-side fallback has had its go, and the caller handles it.
 *
 * Before this file the co-pilot retried once, after a fixed 1.2 s, and `/api/ask` never retried.
 * The policy was written for Gemini on Vertex AI and carried over to Claude unchanged, with 529 added.
 */
export interface RetryPolicy {
  /** Tries in all, the first included. */
  attempts: number
  /** The first wait's ceiling; each later ceiling is twice the one before, up to `capMs`. */
  baseMs: number
  capMs: number
  /** A try only starts if at least this long is left before the deadline. */
  minCallMs: number
}

export const RETRY: RetryPolicy = { attempts: 3, baseMs: 500, capMs: 4000, minCallMs: 2000 }

/** Statuses worth another try. 529 is Anthropic's "overloaded". */
export const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529])
/** Statuses that mean "out of capacity for now": the visitor is told it is busy, and when to ask again. */
const BUSY = new Set([429, 529])

/** Each model call's own limit. The request's overall deadline still applies on top. */
export const MODEL_CALL_TIMEOUT_MS = 10_000

/** The wait before retry number `retry` (1 for the first retry): full jitter. `random` is in [0, 1). */
export function backoffMs(retry: number, policy: RetryPolicy, random: () => number): number {
  return Math.floor(random() * Math.min(policy.capMs, policy.baseMs * 2 ** (retry - 1)))
}

/** A Retry-After header as milliseconds: either a number of seconds or an HTTP date. Null if absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const when = Date.parse(trimmed)
  return Number.isNaN(when) ? null : Math.max(0, when - now)
}

/**
 * An error from a call as the retry policy sees it: the HTTP status, if the API answered, and its
 * Retry-After. Anything without a status (a timeout, our own cut-off, a dropped connection) is
 * worth another try, like a 503. Read from the SDK's typed errors, never from their wording.
 */
export function failureOf(error: unknown, now: number): { status: number | null; retryAfterMs: number | null } {
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return { status: error.status, retryAfterMs: retryAfterMs(error.headers?.get('retry-after') ?? null, now) }
  }
  return { status: null, retryAfterMs: null }
}

/**
 * Whether a fallback model wrote the answer: a `fallback_message` entry in the usage (which also
 * covers later turns kept on the fallback model, which carry no block), or a `fallback` block.
 */
export function fallbackRan(message: ModelMessage): boolean {
  return (message.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message') || message.content.some((block) => block.type === 'fallback')
}

/** One try's numbers, for the trace and the log. The timing runs (docs/decisions/0009-copilot-on-claude.md) read these. */
export interface CallReport {
  name: string
  /** Wall time of this try, ms. */
  ms: number
  /** The HTTP status when the API refused the call; null when it answered or could not be reached. */
  status: number | null
  stopReason: string | null
  /** The model that wrote the answer: the one asked for, or a fallback. */
  model: string | null
  speed: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  fallback: boolean
  /** The refusal's category (`stop_details.category`), `uncategorized` when it has none; null when not a refusal. */
  refusal: string | null
}

export function reportOf(name: string, ms: number, message: ModelMessage | null, status: number | null): CallReport {
  const usage = message?.usage
  return {
    name,
    ms,
    status,
    stopReason: message?.stop_reason ?? null,
    model: message?.model ?? null,
    speed: usage?.speed ?? null,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    fallback: message ? fallbackRan(message) : false,
    refusal: message?.stop_reason === 'refusal' ? (message.stop_details?.category ?? 'uncategorized') : null,
  }
}

/** What the model call needs besides the request. Built once per process; tests pass a fake clock and a seeded `random`. */
export interface ModelGuard {
  breaker: Breaker
  policy: RetryPolicy
  now: () => number
  wait: (ms: number) => Promise<void>
  random: () => number
  /** Told about every try, answered or not. The service logs one line for each (index.ts). */
  report?: (call: CallReport) => void
}

export function modelGuard(overrides: Partial<ModelGuard> = {}): ModelGuard {
  const now = overrides.now ?? Date.now
  return {
    breaker: overrides.breaker ?? memoryBreaker(now),
    policy: overrides.policy ?? RETRY,
    now,
    wait: overrides.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: overrides.random ?? Math.random,
    report: overrides.report,
  }
}

/**
 * Why a call gave no answer. `circuit-open`: the breaker refused it and no call was made. `busy`: the
 * API said it was out of capacity (429 rate limited, 529 overloaded). `failed`: anything else, or no
 * time left. An answer is any message, a refusal included: the caller reads its `stop_reason`.
 */
export type ModelOutcome =
  | { ok: true; message: ModelMessage }
  | { ok: false; reason: 'circuit-open' | 'busy' | 'failed'; status: number | null; retryAfterMs: number | null }

/**
 * Sends one request to the model. `deadline` is the request's own (ms since the epoch); each try is
 * also cut off after `callTimeoutMs`. `name` names the steps in the request's trace.
 */
export async function callModel(model: Model, request: ModelRequest, guard: ModelGuard, options: { deadline: number; callTimeoutMs: number; name: string }): Promise<ModelOutcome> {
  const { breaker, policy, now, wait, random } = guard
  const admission = await breaker.admit()
  if (!admission.allowed) return { ok: false, reason: 'circuit-open', status: null, retryAfterMs: admission.retryAfterMs }

  let status: number | null = null
  let asked: number | null = null
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    const left = options.deadline - now()
    if (left <= 0) break
    const name = attempt === 1 ? options.name : `${options.name}, try ${attempt}`
    // The trace's step for this try; its numbers are filled in once the try ends.
    const facts: Record<string, string> = {}
    const started = Date.now()
    const tried = await span(
      name,
      async () => {
        try {
          return { message: await model.generate(request, AbortSignal.timeout(Math.max(1, Math.min(left, options.callTimeoutMs)))), failure: null }
        } catch (error) {
          return { message: null, failure: failureOf(error, now()) }
        }
      },
      facts,
    )
    const report = reportOf(name, Date.now() - started, tried.message, tried.failure?.status ?? null)
    for (const [key, value] of Object.entries(report)) if (key !== 'name' && value !== null && value !== false && value !== 0) facts[key] = String(value)
    guard.report?.(report)
    if (tried.message) {
      // Any answer means the model is up, a refusal included.
      await breaker.succeeded(admission.trial)
      return { ok: true, message: tried.message }
    }
    status = tried.failure?.status ?? null
    asked = tried.failure?.retryAfterMs ?? null
    if (status !== null && !RETRYABLE.has(status)) {
      // The API answered, so it is up; the request (or the key) was wrong. Not the model's failure.
      await breaker.succeeded(admission.trial)
      return { ok: false, reason: 'failed', status, retryAfterMs: null }
    }
    if (admission.trial || attempt === policy.attempts) break
    const delay = Math.max(backoffMs(attempt, policy, random), asked ?? 0)
    if (now() + delay + policy.minCallMs > options.deadline) break
    await wait(delay)
  }
  await breaker.failed(admission.trial)
  return { ok: false, reason: status !== null && BUSY.has(status) ? 'busy' : 'failed', status, retryAfterMs: asked }
}
