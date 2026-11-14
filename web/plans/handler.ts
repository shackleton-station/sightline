import { hourOf } from '../src/lib/mission'
import { decodeView, encodeView, parseCustomSite, type ViewState } from '../src/lib/urlState'
import { originAllowed, reply, visitorOf } from '../shared/http'
import { ID_LETTERS, newId } from '../shared/ids'
import { type Identity, whoIs } from '../shared/identity'
import type { Limiter, SharedStore } from '../shared/store'
import type { SiteData } from '../shared/tools/data'
import { DEFAULT_LIMITS } from '../shared/tools/defaults'
import { type Fact, isoAt, latitudeLabel, limitsLabel, longitudeLabel } from '../shared/tools/facts'
import { runTool } from '../shared/tools/tools'
import { span } from '../shared/trace'
import { cursorOf, readCursor } from './cursor'
import { fingerprintOf, KEY_HOURS, keyOf, REPLAYED_HEADER } from './idempotency'
import type { KeptKey, Plan, PlanStore } from './store'

/**
 * What the plans API needs from outside itself. The plans service passes exactly this. The web
 * server's own, larger `Deps` has the same fields, so it can still call `handlePlans` while the
 * route is being moved (docs/ARCHITECTURE_PHASE_2.md).
 */
export interface PlansDeps {
  /** Where shared mission plans are saved; null when no database is configured. */
  plans?: PlanStore | null
  /** Sign-in with Google, so a plan can have an owner; nothing when not configured, and plans are then anonymous. */
  identity?: Identity | null
  /** Extra origins allowed to call the API (local dev). The site's own is always allowed. */
  allowedOrigins: string[]
  /** Addresses of our own proxies (the load balancer), skipped when working out who the visitor is. */
  trustedProxies?: string[]
  /** The clock, for rate limits and expiry times. */
  now?: () => number
}

export interface PlanLimits {
  /** Saving a plan: per visitor per minute, and everyone together per day. */
  save: Limiter
  saveDay: Limiter
  /** Opening a plan: per visitor per minute. */
  open: Limiter
}

const MINUTE_MS = 60_000

/**
 * The plans API's rate limits, counted in `store`. One place for the numbers and the names, so the
 * plans service and the web server enforce the same limits against the same Redis keys
 * (`clps:limit:plans:…`): a visitor's allowance is one, whichever of the two answers.
 */
export function planLimits(store: SharedStore): PlanLimits {
  return {
    save: store.limiter('plans:save', 5, MINUTE_MS),
    saveDay: store.limiter('plans:save-day', 300, 24 * 60 * MINUTE_MS),
    open: store.limiter('plans:open', 60, MINUTE_MS),
  }
}

const MAX_TITLE = 80
const MAX_NOTE = 400
const MAX_BODY_CHARS = 4000
/** A plan is kept for this long, then the database deletes it. */
const KEEP_DAYS = 180
const ID_LENGTH = 8
const ID_SHAPE = new RegExp(`^[${ID_LETTERS}]{${ID_LENGTH}}$`)
/**
 * How many of their own plans one page of "my plans" holds when the request does not say. 50 is
 * what the list returned before it had pages, so a page loaded before paging existed, which sends
 * no `limit`, gets the same first page as it always did.
 */
const PAGE_SIZE = 50
/**
 * The most one page may hold. Each plan listed is one document read, billed, and a visitor may
 * list 60 times a minute, so this bounds one visitor at 6,000 reads a minute. A page of 100 lines
 * is about 12 KB. Nobody needs more on one screen: "Show more" fetches the next.
 */
const MAX_PAGE_SIZE = 100

/** A plan as a browser may see it: everything but whose it is. */
function shown({ owner: _owner, ...plan }: Plan): Omit<Plan, 'owner'> {
  return plan
}

/** One line of text from a visitor: trimmed, on one line, no longer than `max`. Null if it isn't text. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : null
}

/** The facts worth keeping from a tool's answer, in the order given. */
function pick(facts: Fact[], keys: string[]): { label: string; value: string }[] {
  return keys.flatMap((key) => facts.filter((item) => item.key === key).map(({ label, value }) => ({ label, value })))
}

/**
 * What the data says about a plan, worked out by the same tools the co-pilot uses, at the moment it
 * is saved. Whoever opens the link sees this without having to know the app.
 */
async function briefFor(view: ViewState, data: SiteData): Promise<Plan['brief']> {
  const limits = { label: 'Checked against', value: limitsLabel(view.requirements) }
  const point = parseCustomSite(view.a.site)
  if (point) {
    return [{ label: 'Place', value: `A custom point at ${latitudeLabel(point.lat)}, ${longitudeLabel(point.lon)}` }, limits]
  }
  const context = { data, requirements: view.requirements }
  const flags = await data.flags(view.a.site)
  const time = isoAt(flags.start, hourOf(flags.start, `${view.a.month}-01T00:00:00Z`) + view.index)
  const [hour, month] = await Promise.all([
    runTool('conditions_at', { site: view.a.site, time }, context),
    runTool('month_summary', { site: view.a.site, month: view.a.month }, context),
  ])
  return [
    ...(hour.ok ? pick(hour.facts, ['site', 'time', 'headline', 'landing', 'problem_1', 'next_landing']) : []),
    limits,
    ...(month.ok ? pick(month.facts, ['month', 'pct_sun', 'pct_earth', 'longest_without_sun', 'landing_days']) : []),
    ...(view.shortlist.length > 0 ? [{ label: 'Options on the shortlist', value: String(view.shortlist.length) }] : []),
  ]
}

/** POST /api/plans: saves the view on screen as a plan and returns its id. */
async function savePlan(request: Request, deps: PlansDeps, limits: PlanLimits, data: SiteData, plans: PlanStore): Promise<Response> {
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  const visitor = visitorOf(request, deps.trustedProxies)
  const allowed = await Promise.all([limits.save.take(visitor), limits.saveDay.take('all')])
  if (allowed.includes(false)) return reply({ error: 'busy' }, 429)

  // Signing in is optional. A token that doesn't check out is refused, not ignored: saving the plan
  // without an owner would look the same to the visitor and leave them unable to delete it.
  const who = await whoIs(request, deps.identity)
  if (who.kind === 'invalid') return reply({ error: 'sign-in' }, 401)

  const text = await request.text()
  let body: { title?: unknown; note?: unknown; view?: unknown }
  try {
    body = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null
  } catch {
    return reply({ error: 'bad-plan' }, 400)
  }
  const title = line(body?.title, MAX_TITLE)
  const note = line(body?.note ?? '', MAX_NOTE)
  // The view is decoded and written out again, so only what the app itself can open is stored.
  const view = typeof body?.view === 'string' && body.view.length <= 1500 ? decodeView(body.view, DEFAULT_LIMITS) : null
  const sites = await data.sites()
  const known = view && (parseCustomSite(view.a.site) !== null || sites.some((site) => site.id === view.a.site))
  if (!title || note === null || !view || !known) return reply({ error: 'bad-plan' }, 400)
  // An idempotency key is optional (idempotency.ts). One that is sent has to be a key.
  const key = keyOf(request)
  if (key.kind === 'bad') return reply({ error: 'bad-key' }, 400)

  const now = deps.now?.() ?? Date.now()
  const owner = who.kind === 'owner' ? { owner: who.owner } : {}
  const asked = { title, note, view: encodeView(view), ...owner }
  const fingerprint = fingerprintOf(asked)
  /** The answer for a key that is already on record: the first answer again, or a refusal if this is a different save. */
  const again = (kept: KeptKey) => (kept.fingerprint === fingerprint ? reply({ id: kept.plan }, 201, { [REPLAYED_HEADER]: 'true' }) : reply({ error: 'key-reused' }, 422))
  const live = (kept: KeptKey) => Date.parse(kept.expires) > now

  const plan: Omit<Plan, 'id'> = {
    ...asked,
    brief: await span('brief from the data', () => briefFor(view, data)),
    created: new Date(now).toISOString(),
    expires: new Date(now + KEEP_DAYS * 86_400_000).toISOString(),
  }
  /**
   * Save first, look the key up only if the save is refused. A first save is by far the usual
   * case, and this way a key costs it no extra trip to the database: the plan and the key's record
   * go in one atomic write, where a save without a key makes one write too. Only a retry, a reused
   * key or (almost never) a taken id pays for the second trip.
   */
  // The version of this key's expired record, once one has been found, so the next try replaces exactly it.
  let stale: string | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Ids are random; if one is taken (it almost never is), the next turn of the loop picks another.
    const id = newId(ID_LENGTH)
    const record = key.kind === 'key' ? { id: key.id, plan: id, fingerprint, expires: new Date(now + KEY_HOURS * 3_600_000).toISOString(), replaces: stale } : undefined
    if (await span('save to Firestore', () => plans.create({ id, ...plan }, record))) return reply({ id }, 201)
    if (key.kind === 'key') {
      // Nothing was written. Why not? If the key is on record, an earlier request with this key
      // saved its plan (the first try of a retry, or the other of two at once), and its answer is
      // this request's answer too.
      const kept = await span('look up the idempotency key', () => plans.savedBy(key.id))
      if (kept && live(kept)) return again(kept)
      // No live record. Either the key's record has expired and the database has not removed it
      // yet, in which case the next try replaces that exact record; or the plan's id was taken.
      stale = kept?.version
    }
  }
  return reply({ error: 'server' }, 500)
}

/** GET /api/plans/<id>: one saved plan. `mine` tells a signed-in visitor it is theirs to delete. */
async function openPlan(request: Request, deps: PlansDeps, limits: PlanLimits, plans: PlanStore, id: string): Promise<Response> {
  if (!(await limits.open.take(visitorOf(request, deps.trustedProxies)))) return reply({ error: 'busy' }, 429)
  // An id that couldn't be one of ours never reaches the database.
  const plan = ID_SHAPE.test(id) ? await span('read from Firestore', () => plans.get(id)) : null
  if (!plan) return reply({ error: 'not-found' }, 404)
  const who = await whoIs(request, deps.identity)
  return reply({ plan: shown(plan), mine: who.kind === 'owner' && plan.owner === who.owner })
}

/** A page size as asked for in `?limit=`: a whole number from 1 to MAX_PAGE_SIZE. Absent means PAGE_SIZE; anything else is null. */
function pageSizeOf(text: string | null): number | null {
  if (text === null) return PAGE_SIZE
  if (!/^\d{1,3}$/.test(text)) return null
  const size = Number(text)
  return size >= 1 && size <= MAX_PAGE_SIZE ? size : null
}

/**
 * GET /api/plans: one page of the signed-in visitor's own plans, newest first.
 *
 * `?limit=` sets the page size and `?after=` is the `next` marker of the page before (cursor.ts).
 * The reply carries `next` only when more plans follow. Both are optional, so a request without
 * them gets the first page in the shape the list always had.
 */
async function listPlans(request: Request, deps: PlansDeps, limits: PlanLimits, plans: PlanStore): Promise<Response> {
  if (!(await limits.open.take(visitorOf(request, deps.trustedProxies)))) return reply({ error: 'busy' }, 429)
  const who = await whoIs(request, deps.identity)
  if (who.kind !== 'owner') return reply({ error: 'sign-in' }, 401)
  const query = new URL(request.url).searchParams
  const limit = pageSizeOf(query.get('limit'))
  if (limit === null) return reply({ error: 'bad-limit' }, 400)
  const marker = query.get('after')
  const after = marker === null ? undefined : readCursor(marker)
  if (after === null) return reply({ error: 'bad-cursor' }, 400)
  const page = await span('list from Firestore', () => plans.pageByOwner(who.owner, { limit, after }))
  const last = page.plans.at(-1)
  return reply({
    plans: page.plans.map(({ id, title, created, expires }) => ({ id, title, created, expires })),
    ...(page.more && last ? { next: cursorOf(last) } : {}),
  })
}

/** DELETE /api/plans/<id>: only the person who saved it may. */
async function deletePlan(request: Request, deps: PlansDeps, limits: PlanLimits, plans: PlanStore, id: string): Promise<Response> {
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  if (!(await limits.save.take(visitorOf(request, deps.trustedProxies)))) return reply({ error: 'busy' }, 429)
  const who = await whoIs(request, deps.identity)
  if (who.kind !== 'owner') return reply({ error: 'sign-in' }, 401)
  const plan = ID_SHAPE.test(id) ? await span('read from Firestore', () => plans.get(id)) : null
  if (!plan) return reply({ error: 'not-found' }, 404)
  // Someone else's plan, or one saved without signing in: nobody may delete it. It expires on its own.
  if (plan.owner !== who.owner) return reply({ error: 'not-yours' }, 403)
  await span('delete from Firestore', () => plans.remove(id))
  return reply({ deleted: id })
}

/** The plans API. `rest` is the path after /api/plans. */
export async function handlePlans(request: Request, deps: PlansDeps, limits: PlanLimits, data: SiteData, rest: string): Promise<Response> {
  const plans = deps.plans
  if (!plans) return reply({ error: 'not-configured' }, 503)
  try {
    if (rest === '' || rest === '/') {
      if (request.method === 'POST') return await savePlan(request, deps, limits, data, plans)
      if (request.method === 'GET') return await listPlans(request, deps, limits, plans)
      return reply({ error: 'method' }, 405)
    }
    const id = rest.slice(1)
    if (request.method === 'GET') return await openPlan(request, deps, limits, plans, id)
    if (request.method === 'DELETE') return await deletePlan(request, deps, limits, plans, id)
    return reply({ error: 'method' }, 405)
  } catch (error) {
    console.error('plans failed', error)
    return reply({ error: 'upstream' }, 502)
  }
}
