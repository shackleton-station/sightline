import { ID_LETTERS } from '../shared/ids'
import type { PageStart } from './store'

/**
 * The "next page" marker of GET /api/plans (API.md, "List my plans").
 *
 * It holds the `created` time and the id of the last plan on the page, and nothing else: two values
 * the visitor was just sent in that same page. The owner is never in it. Which plans are listed
 * comes from the visitor's sign-in, so a marker that is edited, or copied from someone else, can
 * only move where the visitor's own list starts. That is why it needs no signature, and so no
 * secret.
 *
 * It is written as base64url of a small JSON list, so it travels in an address as it is. The pages
 * treat it as opaque: they send back exactly what they were given. Its form may change; if it does,
 * the service keeps reading the old form for as long as a tab could still hold one.
 */

/** Longer than any marker this service writes (about 70 characters), short enough to read cheaply. */
const MAX_CURSOR = 200
const ID_SHAPE = new RegExp(`^[${ID_LETTERS}]{8}$`)
/** A time as Firestore and `toISOString` write it, in UTC, with up to nanoseconds. */
const TIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/

/** The marker for "the page after this plan". */
export function cursorOf(plan: PageStart): string {
  return Buffer.from(JSON.stringify([plan.created, plan.id])).toString('base64url')
}

/** Where a marker says the page starts, or null if it is not one this service wrote. */
export function readCursor(text: string): PageStart | null {
  if (text.length === 0 || text.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(text)) return null
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(value) || value.length !== 2) return null
  const [created, id] = value
  if (typeof created !== 'string' || !TIME_SHAPE.test(created) || !Number.isFinite(Date.parse(created))) return null
  if (typeof id !== 'string' || !ID_SHAPE.test(id)) return null
  return { created, id }
}
