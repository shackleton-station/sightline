import { createHash } from 'node:crypto'

/**
 * Idempotency keys for "save a plan".
 *
 * A save can be sent twice without the visitor meaning it: the answer is lost on a bad connection
 * and the page tries again, or a button is pressed twice. Without a key the server cannot tell a
 * retry from a second plan, and saves two. So the page makes up a random key for each attempt to
 * save and sends it in the `Idempotency-Key` header, and sends the same key again when it retries.
 * The server remembers, for a day, which plan each key made:
 *
 *   the key is new                      the plan is saved, and the key is recorded with it
 *   the same key, the same plan again   nothing is saved; the first answer is given again
 *   the same key, a different plan      refused (422): the key already means something else
 *
 * The header and the 422 follow the IETF draft "The Idempotency-Key HTTP Header Field"
 * (draft-ietf-httpapi-idempotency-key-header). The draft also names 409 for "the first request is
 * still running". This server never answers that: the plan and the key's record are written in one
 * atomic step, so of two requests racing with one key, one wins and the other reads the winner's
 * record and gives its answer (handler.ts).
 *
 * The key is optional. A save without one works exactly as it did before keys existed.
 */

/** The header the page sends. */
export const KEY_HEADER = 'idempotency-key'
/** The header on an answer that was given again and not worked out afresh. */
export const REPLAYED_HEADER = 'idempotent-replayed'
/**
 * How long a key is remembered. The page only reuses a key inside one visit, seconds or minutes
 * after the first try. A day covers a tab left open overnight, and is the age after which Stripe's
 * API, a widely used implementation, lets a key be removed. Longer only costs stored records.
 */
export const KEY_HOURS = 24

/** Long enough that nobody lands on someone else's key by accident; short enough to store. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,64}$/

/**
 * The key a request carries: none, one that is not a key (`bad`), or the name its record is kept
 * under. The draft writes the value as a quoted string, `"8e03978e-…"`; a bare value is accepted too.
 * The record is named by a hash of the key, so whatever a visitor sends is safe in a document's
 * path, and the key itself is not stored.
 */
export function keyOf(request: Request): { kind: 'none' } | { kind: 'bad' } | { kind: 'key'; id: string } {
  const sent = request.headers.get(KEY_HEADER)
  if (sent === null) return { kind: 'none' }
  const trimmed = sent.trim()
  const value = /^".*"$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed
  if (!KEY_SHAPE.test(value)) return { kind: 'bad' }
  return { kind: 'key', id: createHash('sha256').update(value).digest('hex').slice(0, 40) }
}

/**
 * A fingerprint of what a save asks for: the plan as it would be stored, and whose it would be.
 * Two requests with the same fingerprint are the same save. It is taken after the server has
 * cleaned the title, the note and the view, so a retry that differs only in spacing still matches.
 */
export function fingerprintOf(plan: { title: string; note: string; view: string; owner?: string }): string {
  return createHash('sha256')
    .update(JSON.stringify([plan.title, plan.note, plan.view, plan.owner ?? '']))
    .digest('hex')
    .slice(0, 32)
}
