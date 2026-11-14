import { within } from '../shared/redisStore'

/**
 * A circuit breaker around the model.
 *
 * THE PROBLEM. When the model is down or out of capacity, every question still waits for it: up to
 * 25 s, and several tries, before the visitor is told it is busy. Each of those waits holds a slot
 * in a copy of the service, and each try adds to the load on a model that is already failing. A
 * failure upstream turns into slow failures here (a "cascading failure").
 *
 * THE PATTERN. Count recent failures. Past a threshold, stop calling the model for a while ("open"):
 * every question is told at once that the co-pilot is busy, with a `Retry-After`, and no model call
 * is made. When the while is over, let exactly one question through as a trial ("half-open"). If it
 * works, close the breaker and carry on; if not, open it again.
 *
 *   closed ──(5 failed model calls within 60 s)──► open ──(30 s)──► half-open ──(the trial works)──► closed
 *                                                    ▲                   │
 *                                                    └──(the trial fails)┘
 *
 * WHERE THE STATE LIVES. In Redis, so every copy of the service agrees: one copy that has seen the
 * model fail stops the others calling it too. One key holds the whole state as JSON, and each change is a compare-and-set (only write if
 * the key still holds what was read), so two copies changing it at the same moment cannot undo each
 * other. Without Redis, or while it cannot be reached, each copy keeps its own state in memory: the
 * breaker still protects that copy, only the copies no longer agree.
 *
 * WHAT COUNTS AS A FAILURE. One model call that still failed after its retries (copilot/modelCall.ts):
 * no answer in time, a dropped connection, or an answer of 408, 429 or 5xx. A question makes at most
 * one such failed call, because the co-pilot stops at the first. A 400 is our request's fault, not
 * the model's, and does not count.
 *
 * THE NUMBERS, and what they rest on (docs/decisions/0004-copilot-service.md):
 * - 5 failures within 60 s. The baseline day (docs/ARCHITECTURE_BASELINE.md 1.1) had 158 questions,
 *   about 526 model calls, and one model failure in all. Five failed questions in one minute is far
 *   outside that, and still low enough that at most five visitors wait out a full failure before the
 *   rest are told at once. The co-pilot's own ceiling is 30 questions a minute for everyone together.
 * - 30 s open. Long enough that a model which is out of capacity is not asked again at once; short
 *   enough that a visitor told to wait is not kept out long after it recovers.
 * - One trial at a time, given 15 s to finish (a model call's own limit is 10 s). If the copy holding
 *   the trial stops before it reports, the next question after 15 s becomes the trial.
 */
export type BreakerState = 'closed' | 'open' | 'half-open'

export interface BreakerSettings {
  /** Failed model calls within `windowMs` that open the breaker. */
  failures: number
  windowMs: number
  /** How long it stays open before a trial. */
  openMs: number
  /** How long one trial may take before another question may try instead. */
  trialMs: number
}

export const BREAKER: BreakerSettings = { failures: 5, windowMs: 60_000, openMs: 30_000, trialMs: 15_000 }

/** What is stored: the whole state, small enough to be one Redis value. */
export interface BreakerRecord {
  state: BreakerState
  /** Times of recent failures, while closed. Never more than `failures` of them. */
  failures: number[]
  openUntil: number
  /** While half-open: when the trial in hand may be given up on. 0 when there is none. */
  trialUntil: number
}

const CLOSED: BreakerRecord = { state: 'closed', failures: [], openUntil: 0, trialUntil: 0 }

/** Whether a model call may go ahead, and if not, how long to wait. */
export type Admission = { allowed: true; trial: boolean } | { allowed: false; state: BreakerState; retryAfterMs: number }

/** What the breaker looks like now, without changing it. */
export interface BreakerView {
  state: BreakerState
  /** 0 when a call would be let through now. */
  retryAfterMs: number
}

export interface Breaker {
  kind: 'redis' | 'memory'
  /** A look that changes nothing and takes no trial: would a call be let through now? */
  peek(): Promise<BreakerView>
  /** Asks to make a model call. In half-open, the first to ask gets the one trial. */
  admit(): Promise<Admission>
  /** The call worked (the model answered). Closes the breaker if it was the trial. */
  succeeded(trial: boolean): Promise<void>
  /** The call failed, after its retries. */
  failed(trial: boolean): Promise<void>
}

/** The state as it stands at `now`: an open breaker whose time is up is half-open. */
export function viewOf(record: BreakerRecord, now: number): BreakerView {
  if (record.state === 'closed') return { state: 'closed', retryAfterMs: 0 }
  if (record.state === 'open' && now < record.openUntil) return { state: 'open', retryAfterMs: record.openUntil - now }
  // Half-open: free for a trial, or busy with one until it reports or runs out of time.
  return { state: 'half-open', retryAfterMs: record.trialUntil > now ? record.trialUntil - now : 0 }
}

/** Each step below gives the new record to store (null: nothing changes) and what to tell the caller. */
type Step<T> = { next: BreakerRecord | null; result: T }

export function admitStep(record: BreakerRecord, now: number, settings: BreakerSettings): Step<Admission> {
  const view = viewOf(record, now)
  if (view.state === 'closed') return { next: null, result: { allowed: true, trial: false } }
  if (view.retryAfterMs > 0) return { next: null, result: { allowed: false, state: view.state, retryAfterMs: view.retryAfterMs } }
  return { next: { ...record, state: 'half-open', trialUntil: now + settings.trialMs }, result: { allowed: true, trial: true } }
}

export function failedStep(record: BreakerRecord, now: number, trial: boolean, settings: BreakerSettings): Step<void> {
  const open: BreakerRecord = { state: 'open', failures: [], openUntil: now + settings.openMs, trialUntil: 0 }
  // The trial failed, or a call let through before the breaker opened failed while it was half-open.
  if (trial || record.state === 'half-open') return { next: open, result: undefined }
  // Already open: a call that started before it opened has nothing to add.
  if (record.state === 'open') return { next: null, result: undefined }
  const recent = [...record.failures.filter((at) => now - at < settings.windowMs), now].slice(-settings.failures)
  return { next: recent.length >= settings.failures ? open : { ...record, failures: recent }, result: undefined }
}

export function succeededStep(record: BreakerRecord, trial: boolean): Step<void> {
  // Only the trial closes it. A success from a call that started before the breaker opened says
  // nothing about the model now.
  return { next: trial && record.state === 'half-open' ? CLOSED : null, result: undefined }
}

function readRecord(text: string | null): BreakerRecord {
  if (!text) return CLOSED
  try {
    const value = JSON.parse(text) as Partial<BreakerRecord>
    const state = value.state === 'open' || value.state === 'half-open' ? value.state : 'closed'
    const failures = Array.isArray(value.failures) ? value.failures.filter((at): at is number => typeof at === 'number') : []
    return { state, failures, openUntil: Number(value.openUntil) || 0, trialUntil: Number(value.trialUntil) || 0 }
  } catch {
    return CLOSED
  }
}

/**
 * Where the record is kept. `write` stores `next` only if the value is still `expected` (what was
 * read), and says whether it did: a compare-and-set.
 */
export interface BreakerStore {
  read(): Promise<string | null>
  write(expected: string | null, next: string): Promise<boolean>
}

/** A breaker over any store. A write that loses a race is read and worked out again, a few times. */
export function breakerOver(store: BreakerStore, kind: Breaker['kind'], now: () => number = Date.now, settings: BreakerSettings = BREAKER): Breaker {
  async function change<T>(step: (record: BreakerRecord) => Step<T>): Promise<T> {
    let last: T | undefined
    for (let attempt = 0; attempt < 4; attempt++) {
      const text = await store.read()
      const { next, result } = step(readRecord(text))
      if (!next || (await store.write(text, JSON.stringify(next)))) return result
      last = result
    }
    // Four races lost in a row: others are changing it right now, and their change stands.
    return last as T
  }
  return {
    kind,
    peek: async () => viewOf(readRecord(await store.read()), now()),
    admit: () => change((record) => admitStep(record, now(), settings)),
    succeeded: (trial) => change((record) => succeededStep(record, trial)),
    async failed(trial) {
      let opened = false
      await change((record) => {
        const step = failedStep(record, now(), trial, settings)
        opened = step.next?.state === 'open'
        return step
      })
      // One line each time it opens: the alert "the co-pilot's circuit breaker opened" (infra/copilot.tf) matches it.
      if (opened) console.warn(`Circuit breaker opened (${kind}): ${trial ? 'the trial question failed' : `${settings.failures} model calls failed within ${settings.windowMs / 1000} s`}; questions are told to wait ${settings.openMs / 1000} s`)
    },
  }
}

/** The breaker in this process's memory: one copy's own, for tests, one machine, and as the fallback. */
export function memoryBreaker(now: () => number = Date.now, settings: BreakerSettings = BREAKER): Breaker {
  let value: string | null = null
  const store: BreakerStore = {
    read: () => Promise.resolve(value),
    write(expected, next) {
      if (value !== expected) return Promise.resolve(false)
      value = next
      return Promise.resolve(true)
    },
  }
  return breakerOver(store, 'memory', now, settings)
}

/** The two Redis commands the breaker needs. Tests pass a fake; `redisClient.ts` passes the real ones. */
export interface BreakerRedis {
  get(key: string): Promise<string | null>
  /** Sets `key` to `next` with an expiry, only if it still holds `expected` (or is missing, for null). True if written. */
  compareAndSet(key: string, expected: string | null, next: string, ttlMs: number): Promise<boolean>
}

/** The compare-and-set as one atomic step on Redis. KEYS[1] · ARGV[1] expected ("" for missing) · ARGV[2] next · ARGV[3] expiry in ms */
export const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if (current or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
return 1`

/** One key for every copy. The prefix names the service, as plans' and voice's keys do. */
export const BREAKER_KEY = 'clps:copilot:breaker'
/** The key expires a day after its last change: a breaker nobody has touched for a day is closed. */
const KEEP_MS = 24 * 60 * 60_000

/**
 * The breaker on Redis, shared by every copy. If Redis is slow or down, each call falls back to
 * `fallback` (this copy's memory) and says so at most once a minute.
 */
export function redisBreaker(redis: BreakerRedis, fallback: Breaker = memoryBreaker(), now: () => number = Date.now, settings: BreakerSettings = BREAKER): Breaker {
  const shared = breakerOver(
    {
      read: () => within(redis.get(BREAKER_KEY)),
      write: (expected, next) => within(redis.compareAndSet(BREAKER_KEY, expected, next, KEEP_MS)),
    },
    'redis',
    now,
    settings,
  )
  let lastComplaint = Number.NEGATIVE_INFINITY
  const fallingBack = <T>(work: (breaker: Breaker) => Promise<T>) =>
    work(shared).catch((error: unknown) => {
      if (now() - lastComplaint > 60_000) {
        lastComplaint = now()
        console.warn("Circuit breaker: Redis unavailable; using this copy's memory for now:", error instanceof Error ? error.message : error)
      }
      return work(fallback)
    })
  return {
    kind: 'redis',
    peek: () => fallingBack((breaker) => breaker.peek()),
    admit: () => fallingBack((breaker) => breaker.admit()),
    succeeded: (trial) => fallingBack((breaker) => breaker.succeeded(trial)),
    failed: (trial) => fallingBack((breaker) => breaker.failed(trial)),
  }
}
