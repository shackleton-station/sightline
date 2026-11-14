import { reply } from '../shared/http'
import type { Attempt, Limiter } from '../shared/store'

/**
 * "Busy, try again later", said the same way by both of the co-pilot's endpoints: a status (429 or
 * 503), a `Retry-After` header in whole seconds, and the same number in the body as
 * `retryAfterSeconds` for a page that reads the body rather than the headers (and for a stream,
 * whose headers have gone before it knows). The page waits that long before it lets the visitor
 * ask again (src/lib/chatClient.ts).
 */

/** When the model says it is out of capacity and does not say for how long. Long enough for shared capacity to come back. */
export const MODEL_BUSY_WAIT_MS = 10_000

/** A wait as whole seconds, rounded up, never under 1: `Retry-After: 0` would mean "now". */
export function waitSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

export function retryHeaders(ms: number): Record<string, string> {
  return { 'retry-after': String(waitSeconds(ms)) }
}

export function busyReply(status: 429 | 503, waitMs: number, headers: Record<string, string> = {}): Response {
  return reply({ error: 'busy', retryAfterSeconds: waitSeconds(waitMs) }, status, { ...headers, ...retryHeaders(waitMs) })
}

/**
 * True when a request says its body is longer than this many bytes. Requests are read before they
 * are counted against a limit, so one that announces a body no question could need is turned away unread.
 */
export function saysLongerThan(request: Request, bytes: number): boolean {
  const length = Number(request.headers.get('content-length'))
  return Number.isFinite(length) && length > bytes
}

/**
 * Counts a call against every limit, but only if all of them allow it. Null if they did; otherwise
 * the wait, and the call is counted nowhere. So a refused call spends nothing: a visitor over their
 * own limit does not use up the day's shared one, and a full limit clears when its oldest real
 * calls age out, not later.
 *
 * Each limit is looked at first, then counted. Two calls at the same instant can both pass the
 * look; the count itself is still one atomic step per limit, so no limit lets through more than
 * its number.
 */
export async function countIfAllowed(limits: [Limiter, string][]): Promise<number | null> {
  const refused = limitsRefused(await Promise.all(limits.map(([limiter, key]) => limiter.peek(key))))
  if (refused !== null) return refused
  return limitsRefused(await Promise.all(limits.map(([limiter, key]) => limiter.attempt(key))))
}

/**
 * Null if every limit allowed the call. Otherwise the wait until all the limits that refused will
 * allow it again: the longest of their waits, since a visitor over two limits must wait out both.
 */
export function limitsRefused(attempts: Attempt[]): number | null {
  const refused = attempts.filter((attempt) => !attempt.allowed)
  return refused.length === 0 ? null : Math.max(...refused.map((attempt) => attempt.retryAfterMs))
}
