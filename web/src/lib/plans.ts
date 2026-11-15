import { proof, signOut } from './account'
import type { LibraryEntry } from './library'

/** A mission plan someone saved to share. Mirrors what the plans service stores (web/plans/store.ts); the shapes both sides agree on are in web/plans/API.md. */
export interface Plan {
  id: string
  title: string
  note: string
  /** The view to open, as the "#a=…" part of a link. */
  view: string
  /** What the data said about the plan when it was saved. */
  brief: { label: string; value: string }[]
  created: string
  expires: string
}

export const MAX_TITLE = 80
export const MAX_NOTE = 400

const PLAN_PREFIX = '#plan='
const ID_SHAPE = /^[a-hj-km-np-z2-9]{8}$/

/** The plan id in an address like "#plan=abcd2345", or null if it isn't one. */
export function planIdFrom(hash: string): string | null {
  const id = hash.startsWith(PLAN_PREFIX) ? hash.slice(PLAN_PREFIX.length) : ''
  return ID_SHAPE.test(id) ? id : null
}

/** The part of the address that opens a plan. */
export function planHash(id: string): string {
  return `${PLAN_PREFIX}${id}`
}

/** What to tell someone when a plan can't be saved or opened. */
export function planFailure(status: number, saving: boolean): string {
  if (status === 401) return 'Your sign-in has run out. Sign in again and retry.'
  if (status === 404) return 'This plan no longer exists. Plans are kept for six months.'
  if (status === 429) return 'Too many plans at once. Give it a minute and try again.'
  if (status === 503) return "Sharing plans isn't switched on here yet."
  if (status === 400 && saving) return 'That plan could not be saved. Give it a title and try again.'
  return saving ? "The plan couldn't be saved just now. Try again in a moment." : "The plan couldn't be loaded just now. Try again in a moment."
}

/** `status` is the server's HTTP status when it answered with a refusal; absent when it could not be reached. */
export type PlanResult<T> = { ok: true; value: T } | { ok: false; message: string; status?: number }

/** The server's answer to a key it has already seen with a different plan (web/plans/API.md). */
export const KEY_REUSED = 422

const OFFLINE = "Couldn't reach the server. Check your connection and try again."

/** The server said the sign-in is no good (it lasts an hour): sign out here too, so the page shows it. */
function noteStatus(status: number) {
  if (status === 401) signOut()
}

/** One attempt to save: what was to be saved, and the key that names the attempt to the server. */
export interface SaveAttempt {
  /** Everything that makes this save what it is: the plan, and whether it would have an owner. */
  what: string
  /** A random key, sent with the request so the server can tell a retry from a second plan. */
  key: string
}

/** A random key for one attempt to save. */
function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // A page not served over HTTPS has no randomUUID. Random bytes do the same job.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The attempt a press of Save belongs to. Pressing Save again after a failure, with nothing changed,
 * is the same attempt and keeps its key: if the first try did reach the server, the server answers
 * with the plan it already saved instead of saving another. Any change to the plan, or signing in or
 * out, makes it a new attempt with a new key. (The agreement with the server is in web/plans/API.md.)
 */
export function attemptFor(previous: SaveAttempt | null, plan: { title: string; note: string; view: string }, signedIn: boolean): SaveAttempt {
  const what = JSON.stringify([plan.title, plan.note, plan.view, signedIn])
  return previous?.what === what ? previous : { what, key: newKey() }
}

/** How long to wait before the one automatic retry of a save. */
export const RETRY_AFTER_MS = 800

/**
 * Saves the view on screen as a plan. Returns its id.
 *
 * `key` is the attempt's idempotency key (see `attemptFor`). With it, a save that got no answer, or
 * an answer that leaves open whether the plan was saved (502 or 504), is tried once more by itself:
 * the server gives the first answer again if the plan was saved, and saves it if it was not.
 * Without a key nothing is retried, because a retry could save the plan twice.
 */
export async function savePlan(plan: { title: string; note: string; view: string }, key?: string, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<PlanResult<string>> {
  const send = async (): Promise<{ status: number; id: string | null } | null> => {
    try {
      // The key is written as a quoted string, the form the IETF draft for this header gives.
      const response = await fetch('/api/plans', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': `"${key}"` } : {}), ...proof() }, body: JSON.stringify(plan) })
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null
      return { status: response.status, id: response.ok && typeof body?.id === 'string' ? body.id : null }
    } catch {
      return null
    }
  }
  let answer = await send()
  if (key && (answer === null || answer.status === 502 || answer.status === 504)) {
    await wait(RETRY_AFTER_MS)
    answer = await send()
  }
  if (!answer) return { ok: false, message: OFFLINE }
  noteStatus(answer.status)
  if (answer.id) return { ok: true, value: answer.id }
  return { ok: false, message: planFailure(answer.status, true), status: answer.status }
}

/** Opens a plan. `mine` is true when the signed-in visitor saved it. */
export async function loadPlan(id: string): Promise<PlanResult<{ plan: Plan; mine: boolean }>> {
  try {
    const response = await fetch(`/api/plans/${id}`, { headers: proof() })
    const body = (await response.json().catch(() => null)) as { plan?: Plan; mine?: unknown } | null
    if (response.ok && body?.plan && typeof body.plan.view === 'string') return { ok: true, value: { plan: body.plan, mine: body.mine === true } }
    return { ok: false, message: planFailure(response.status, false) }
  } catch {
    return { ok: false, message: OFFLINE }
  }
}

/**
 * The library: every scenario in the plans that are listed, for anyone. Null in place of the list
 * when this site's service is from before the library (it answers 404) or has no database: there
 * is no library here, which is not a failure to show as one.
 */
export async function loadLibrary(): Promise<PlanResult<LibraryEntry[] | null>> {
  try {
    const response = await fetch('/api/plans/library')
    const body = (await response.json().catch(() => null)) as { scenarios?: unknown } | null
    if (response.ok && Array.isArray(body?.scenarios)) {
      const text = (value: unknown): value is string => typeof value === 'string'
      // Only entries of the described shape are kept, and only their described fields: a newer service may send more.
      const entries = (body.scenarios as Partial<LibraryEntry>[]).flatMap(({ plan, title, saved, site, landing }) => (text(plan) && text(title) && text(saved) && text(site) && text(landing) ? [{ plan, title, saved, site, landing }] : []))
      return { ok: true, value: entries }
    }
    if (response.status === 404 || response.status === 503) return { ok: true, value: null }
    return { ok: false, message: response.status === 429 ? 'Too many requests at once. Give it a minute and try again.' : "The library couldn't be loaded just now. Try again in a moment.", status: response.status }
  } catch {
    return { ok: false, message: OFFLINE }
  }
}

/** One line of the signed-in visitor's own list. */
export type PlanLine = Pick<Plan, 'id' | 'title' | 'created' | 'expires'>

/**
 * How many of their own plans the share dialog asks for at a time. The list there shows about six
 * lines before it scrolls, and most people have a handful of plans, so one page is usually all of
 * them; "Show more" fetches the next.
 */
export const LIST_PAGE = 20

/** One page of the visitor's own plans. `next` asks for the page after it; null when there is none. */
export interface PlanList {
  plans: PlanLine[]
  next: string | null
}

/**
 * One page of the signed-in visitor's own plans, newest first. `after` is the `next` of the page
 * before; left out for the first page. A service from before pages ignores both parameters and
 * sends its newest 50 with no `next`, which this reads as a single page (web/plans/API.md).
 */
export async function listPlans(after?: string): Promise<PlanResult<PlanList>> {
  try {
    const query = new URLSearchParams({ limit: String(LIST_PAGE), ...(after ? { after } : {}) })
    const response = await fetch(`/api/plans?${query}`, { headers: proof() })
    noteStatus(response.status)
    const body = (await response.json().catch(() => null)) as { plans?: PlanLine[]; next?: unknown } | null
    if (response.ok && Array.isArray(body?.plans)) return { ok: true, value: { plans: body.plans, next: typeof body.next === 'string' && body.next !== '' ? body.next : null } }
    return { ok: false, message: planFailure(response.status, false) }
  } catch {
    return { ok: false, message: OFFLINE }
  }
}

/** The list after "Show more": the plans shown, then the new page, never one plan twice. */
export function withPage(shown: PlanLine[], page: PlanLine[]): PlanLine[] {
  const seen = new Set(shown.map((plan) => plan.id))
  return [...shown, ...page.filter((plan) => !seen.has(plan.id))]
}

/** Deletes one of the signed-in visitor's own plans. */
export async function deletePlan(id: string): Promise<PlanResult<true>> {
  try {
    const response = await fetch(`/api/plans/${id}`, { method: 'DELETE', headers: proof() })
    noteStatus(response.status)
    await response.body?.cancel()
    if (response.ok || response.status === 404) return { ok: true, value: true }
    return { ok: false, message: response.status === 403 ? 'Only whoever saved this plan can delete it.' : planFailure(response.status, true) }
  } catch {
    return { ok: false, message: OFFLINE }
  }
}
