/** A mission plan someone saved to share: a view of the app, with a name, a note and a brief. */
export interface Plan {
  id: string
  title: string
  note: string
  /** The view to open, as the "#a=…" part of a link. Checked and rewritten by the server on save. */
  view: string
  /** What the data said about the plan when it was saved, as labelled facts. */
  brief: { label: string; value: string }[]
  /** ISO time the plan was saved. */
  created: string
  /** ISO time after which the database deletes it. */
  expires: string
  /** Whose plan it is: a fingerprint of their sign-in (see shared/identity.ts). Absent when saved without signing in. Never sent to a browser. */
  owner?: string
}

/**
 * The record of one save made with an idempotency key (see idempotency.ts): which plan the key
 * made, and a fingerprint of what was asked for, so a retry can be told from a different request
 * that reuses the key.
 */
export interface SavedKey {
  /** A hash of the key the page sent. The record's name. */
  id: string
  /** The id of the plan that save made. */
  plan: string
  /** A hash of what was asked to be saved. */
  fingerprint: string
  /** ISO time after which the key is forgotten and may be used again. */
  expires: string
}

/** A key's record as read back. `version` names this exact record, for replacing it once it has expired. */
export type KeptKey = SavedKey & { version: string }

/** Where plans are kept. Firestore in production; memory in tests and on one machine. */
export interface PlanStore {
  /** Where this store keeps plans, for the service's status. */
  kind: 'firestore' | 'memory'
  /**
   * Saves a new plan. With `key`, the plan and the key's record are written in one atomic step:
   * both, or neither. False if nothing was written because the plan's id or the key is already
   * taken; `savedBy` then tells which.
   *
   * `key.replaces` is the `version` of an expired record of the same key: the write then replaces
   * exactly that record, and is refused if someone else replaced it first.
   */
  create(plan: Plan, key?: SavedKey & { replaces?: string }): Promise<boolean>
  /**
   * What an idempotency key made, or null if the key is not on record. A record past its `expires`
   * can still come back (the database removes it later, not at that moment), so the caller checks the time.
   */
  savedBy(keyId: string): Promise<KeptKey | null>
  get(id: string): Promise<Plan | null>
  /**
   * One page of one person's plans, newest first: at most `limit`, starting just after `after` in
   * that order (from the start when it is left out). `more` says whether at least one more plan
   * comes after the page. See `newestFirst` for the order, ties included.
   */
  pageByOwner(owner: string, page: { limit: number; after?: PageStart }): Promise<PlanPage>
  remove(id: string): Promise<void>
}

/**
 * Where a page starts: just after the plan with this `created` time and id. These are values, not a
 * reference to a document, so a page can still start here after that plan has been deleted.
 */
export interface PageStart {
  created: string
  id: string
}

export interface PlanPage {
  plans: Plan[]
  /** True when at least one more plan follows the last one on this page. */
  more: boolean
}

/**
 * The order of "my plans": newest first, and between two saved in the same millisecond, the larger
 * id first. It is the order of the Firestore index (owner, created descending, document id
 * descending; infra/data.tf), so every store pages the same way.
 */
export function newestFirst(a: PageStart, b: PageStart): number {
  const byTime = Date.parse(b.created) - Date.parse(a.created)
  if (byTime !== 0) return byTime
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** One page cut from plans already in `newestFirst` order: those after `after`, then `limit` of them. */
export function pageOf(sorted: Plan[], limit: number, after?: PageStart): PlanPage {
  const rest = after ? sorted.filter((plan) => newestFirst(after, plan) < 0) : sorted
  return { plans: rest.slice(0, limit), more: rest.length > limit }
}

/** The most key records the memory store holds. Past it, the oldest go first. */
const MAX_KEYS = 5000

/** Plans kept in this process's memory, for tests and for running without a database. */
export function memoryPlans(): PlanStore {
  const plans = new Map<string, Plan>()
  const keys = new Map<string, KeptKey>()
  let writes = 0
  return {
    kind: 'memory',
    // Nothing here waits, so the check and the two writes cannot be interleaved with another call:
    // that is this store's version of the database's atomic step.
    create(plan, key) {
      if (plans.has(plan.id)) return Promise.resolve(false)
      if (key) {
        const kept = keys.get(key.id)
        if (kept && kept.version !== key.replaces) return Promise.resolve(false)
        if (!kept && key.replaces !== undefined) return Promise.resolve(false)
        const { replaces: _replaces, ...record } = key
        keys.delete(key.id)
        keys.set(key.id, { ...record, version: String(++writes) })
        if (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value as string)
      }
      plans.set(plan.id, plan)
      return Promise.resolve(true)
    },
    savedBy: (keyId) => Promise.resolve(keys.get(keyId) ?? null),
    get: (id) => Promise.resolve(plans.get(id) ?? null),
    pageByOwner: (owner, { limit, after }) =>
      Promise.resolve(
        pageOf(
          [...plans.values()].filter((plan) => plan.owner === owner).sort(newestFirst),
          limit,
          after,
        ),
      ),
    remove(id) {
      plans.delete(id)
      return Promise.resolve()
    },
  }
}
