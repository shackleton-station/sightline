import type { TokenSource } from '../shared/google'
import { type KeptKey, newestFirst, type PageStart, type Plan, type PlanPage, type PlanStore, pageOf } from './store'

export interface FirestoreOptions {
  project: string
  database: string
  /** The API's address. Only tests against the emulator change it. */
  host?: string
  /** The clock, for how long to keep listing the old way after the index was found missing. Tests change it. */
  now?: () => number
}

/** After the index is found missing, how long to list the old way before trying the index again. */
const RECHECK_INDEX_MS = 60_000
/** The most plans of one person the old way reads (it was the limit before the index). */
const OLD_WAY_MAX = 200

/**
 * How long to wait for one call to Firestore. The slowest calls seen from this server are the two
 * saves in the Phase 1 traces (166 ms and 191 ms). Five seconds is far past anything healthy. A
 * save makes one call, a retried save two, and a save under an expired key three, so even with
 * every call at its worst a request ends inside the service's request timeout (infra/plans.tf).
 * A call that takes longer fails, and the visitor is told to try again.
 */
const PATIENCE_MS = 5000

type Fields = Record<string, { stringValue?: string; timestampValue?: string }>
interface FirestoreError {
  error?: { status?: string }
}

/**
 * Mission plans in Firestore, database `plans`, through its REST API with the caller's own identity.
 *
 *   plans/<id>             one document per plan. Firestore deletes it after `expires` (180 days).
 *   idempotency/<key>      one small document per save that carried an idempotency key: which plan
 *                          the key made. Firestore deletes it after `expires` (a day). See idempotency.ts.
 *
 * Both deletions are time-to-live rules declared in infra/ (data.tf and plans.tf). So is the one
 * composite index, plans(owner, created descending), which answers "my plans" (data.tf).
 *
 * A plan's id is its document id, and ids are random (shared/ids.ts), so new plans land all over
 * the id range and no single part of the database takes every new write.
 */
export function firestorePlans(options: FirestoreOptions, token: TokenSource): PlanStore {
  const database = `projects/${options.project}/databases/${options.database}`
  const documents = `${options.host ?? 'https://firestore.googleapis.com'}/v1/${database}/documents`
  const root = `${documents}/plans`
  const headers = async () => ({ 'content-type': 'application/json', authorization: `Bearer ${await token()}` })
  const soon = () => AbortSignal.timeout(PATIENCE_MS)
  const now = options.now ?? Date.now

  const toFields = (plan: Plan): Fields => ({
    title: { stringValue: plan.title },
    note: { stringValue: plan.note },
    view: { stringValue: plan.view },
    // The brief is a short list read and written whole, so it is stored as one piece of text.
    brief: { stringValue: JSON.stringify(plan.brief) },
    created: { timestampValue: plan.created },
    expires: { timestampValue: plan.expires },
    ...(plan.owner ? { owner: { stringValue: plan.owner } } : {}),
  })

  const fromFields = (id: string, fields: Fields | undefined): Plan => {
    const text = (name: string) => fields?.[name]?.stringValue ?? ''
    let brief: Plan['brief'] = []
    try {
      brief = JSON.parse(text('brief')) as Plan['brief']
    } catch {
      // A plan with an unreadable brief still opens; it just has no brief.
    }
    return {
      id,
      title: text('title'),
      note: text('note'),
      view: text('view'),
      brief,
      created: fields?.created?.timestampValue ?? '',
      expires: fields?.expires?.timestampValue ?? '',
      ...(fields?.owner?.stringValue ? { owner: fields.owner.stringValue } : {}),
    }
  }

  type Row = { document?: { name: string; fields?: Fields } }
  const plansIn = (rows: Row[]) => rows.flatMap((row) => (row.document ? [fromFields(row.document.name.slice(row.document.name.lastIndexOf('/') + 1), row.document.fields)] : []))
  const ownedBy = (owner: string) => ({ fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: owner } } })
  const runQuery = async (structuredQuery: object) => fetch(`${documents}:runQuery`, { method: 'POST', headers: await headers(), body: JSON.stringify({ structuredQuery }), signal: soon() })

  // Until this time, "my plans" is listed the old way without trying the index (see pageByOwner).
  let indexMissingUntil = 0

  /**
   * One page of "my plans", answered by the composite index plans(owner ascending, created
   * descending, document id descending), declared in infra/data.tf. The order ends on the document
   * id so that two plans saved in the same millisecond still have a fixed order, and the page starts
   * after the last plan's (created, id) values: a plan saved or deleted between two pages moves
   * nothing. One more plan than the page is asked for, to know whether another page follows.
   *
   * Null when Firestore refuses the query because the index does not exist or is still being
   * built. It answers that with HTTP 400 and the status FAILED_PRECONDITION, in a list because
   * runQuery streams ("The query requires an index…"; seen on the real database on 2026-11-12).
   */
  const indexedPage = async (owner: string, limit: number, after?: PageStart): Promise<PlanPage | null> => {
    const response = await runQuery({
      from: [{ collectionId: 'plans' }],
      where: ownedBy(owner),
      orderBy: [
        { field: { fieldPath: 'created' }, direction: 'DESCENDING' },
        { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
      ],
      ...(after ? { startAt: { values: [{ timestampValue: after.created }, { referenceValue: `${database}/documents/plans/${after.id}` }], before: false } } : {}),
      limit: limit + 1,
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as FirestoreError | FirestoreError[] | null
      const status = (Array.isArray(body) ? body[0] : body)?.error?.status ?? `HTTP ${response.status}`
      if (status === 'FAILED_PRECONDITION') return null
      throw new Error(`Firestore: ${status} listing plans`)
    }
    const plans = plansIn((await response.json()) as Row[])
    return { plans: plans.slice(0, limit), more: plans.length > limit }
  }

  /**
   * "My plans" as it was listed before the index: one equality filter, which the index Firestore
   * keeps on every field answers, at most OLD_WAY_MAX documents in no useful order, sorted by the
   * caller. Used only while the index is missing, so the service works whichever of the index and
   * this code is live first. Someone with more than OLD_WAY_MAX plans may then miss some, as before.
   */
  const oldWay = async (owner: string): Promise<Plan[]> => {
    const response = await runQuery({ from: [{ collectionId: 'plans' }], where: ownedBy(owner), limit: OLD_WAY_MAX })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Firestore: HTTP ${response.status} listing plans`)
    }
    return plansIn((await response.json()) as Row[])
  }

  return {
    kind: 'firestore',
    async create(plan, key) {
      if (!key) {
        // Creating with a chosen id fails if it exists, so two plans can never share one.
        const response = await fetch(`${root}?documentId=${plan.id}`, { method: 'POST', headers: await headers(), body: JSON.stringify({ fields: toFields(plan) }), signal: soon() })
        await response.body?.cancel()
        if (response.status === 409) return false
        if (!response.ok) throw new Error(`Firestore: HTTP ${response.status} saving a plan`)
        return true
      }
      /**
       * One commit, two writes, applied together or not at all.
       *   1. Create the plan, on the condition that its id is free.
       *   2. Create the record of the idempotency key, on the condition that the key has no record
       *      (or, for a key whose record has expired, that the record is still that expired one).
       * If either condition fails, Firestore refuses the whole commit. So there is never a plan
       * whose key was not recorded, which a retry would save a second time, and never a key on
       * record whose plan was not saved, which a retry would be answered with.
       */
      const body = {
        writes: [
          { update: { name: `${database}/documents/plans/${plan.id}`, fields: toFields(plan) }, currentDocument: { exists: false } },
          {
            update: {
              name: `${database}/documents/idempotency/${key.id}`,
              fields: { plan: { stringValue: key.plan }, fingerprint: { stringValue: key.fingerprint }, expires: { timestampValue: key.expires } },
            },
            currentDocument: key.replaces ? { updateTime: key.replaces } : { exists: false },
          },
        ],
      }
      const response = await fetch(`${documents}:commit`, { method: 'POST', headers: await headers(), body: JSON.stringify(body), signal: soon() })
      if (response.ok) {
        await response.body?.cancel()
        return true
      }
      const status = ((await response.json().catch(() => ({}))) as FirestoreError).error?.status ?? `HTTP ${response.status}`
      // A condition failed (the id or the key is taken), or the commit lost to another one writing
      // the same key at the same moment. Nothing was written in any of these. The handler reads the
      // key's record to find out which it was. The status is read by name: ALREADY_EXISTS and
      // ABORTED both arrive as HTTP 409.
      if (status === 'ALREADY_EXISTS' || status === 'FAILED_PRECONDITION' || status === 'ABORTED') return false
      throw new Error(`Firestore: ${status} saving a plan`)
    },
    async savedBy(keyId) {
      const response = await fetch(`${documents}/idempotency/${keyId}`, { headers: await headers(), signal: soon() })
      if (response.status === 404) {
        await response.body?.cancel()
        return null
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Firestore: HTTP ${response.status} reading an idempotency key`)
      }
      const { fields, updateTime } = (await response.json()) as { fields?: Fields; updateTime?: string }
      const kept: KeptKey = { id: keyId, plan: fields?.plan?.stringValue ?? '', fingerprint: fields?.fingerprint?.stringValue ?? '', expires: fields?.expires?.timestampValue ?? '', version: updateTime ?? '' }
      // A record that cannot be read as one is treated as absent, never as a match.
      return kept.plan && kept.fingerprint && kept.expires && kept.version ? kept : null
    },
    async get(id) {
      const response = await fetch(`${root}/${id}`, { headers: await headers(), signal: soon() })
      if (response.status === 404) {
        await response.body?.cancel()
        return null
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Firestore: HTTP ${response.status} reading a plan`)
      }
      const { fields } = (await response.json()) as { fields?: Fields }
      return fromFields(id, fields)
    },
    async pageByOwner(owner, { limit, after }) {
      if (now() >= indexMissingUntil) {
        const page = await indexedPage(owner, limit, after)
        if (page) return page
        indexMissingUntil = now() + RECHECK_INDEX_MS
        console.warn(`Firestore: the index plans(owner, created desc) is not ready; listing the old way (at most ${OLD_WAY_MAX} plans, sorted here) for ${RECHECK_INDEX_MS / 1000} s`)
      }
      return pageOf((await oldWay(owner)).sort(newestFirst), limit, after)
    },
    /**
     * The newest plans of everyone, for the library. Ordered by one field, so the index Firestore
     * keeps on every field by itself answers it: no composite index is needed.
     */
    async newest(limit) {
      const response = await runQuery({ from: [{ collectionId: 'plans' }], orderBy: [{ field: { fieldPath: 'created' }, direction: 'DESCENDING' }], limit })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Firestore: HTTP ${response.status} reading the library`)
      }
      return plansIn((await response.json()) as Row[])
    },
    async remove(id) {
      const response = await fetch(`${root}/${id}`, { method: 'DELETE', headers: await headers(), signal: soon() })
      await response.body?.cancel()
      if (!response.ok && response.status !== 404) throw new Error(`Firestore: HTTP ${response.status} deleting a plan`)
    },
  }
}
