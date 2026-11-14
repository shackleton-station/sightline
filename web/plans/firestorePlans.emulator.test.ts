import { describe, expect, it } from 'vitest'
import { newId } from '../shared/ids'
import { createPlansApp } from './app'
import { firestorePlans } from './firestorePlans'
import { type KeptKey, newestFirst, type PageStart, type Plan } from './store'
import { dataDir, idOf, ORIGIN, save, VIEW } from './testing'

/**
 * The same store code against Google's Firestore emulator, to check what a fake cannot: that the
 * REST calls are shaped right, that the plan and the idempotency key's record really are one atomic
 * write, and what Firestore answers when one of the two conditions fails.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set (CI has no emulator). To run it:
 *
 *   docker run --rm -p 127.0.0.1:8085:8085 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
 *     gcloud emulators firestore start --host-port=0.0.0.0:8085 --project=demo-clps
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx vitest run plans/firestorePlans.emulator.test.ts
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST
const options = { project: 'demo-clps', database: '(default)', host: `http://${emulator}` }
// The emulator takes "owner" as a token that may do anything.
const token = () => Promise.resolve('owner')
const unique = () => Math.random().toString(36).slice(2, 12)
const plan = (overrides: Partial<Plan> = {}): Plan => ({ id: newId(8), title: 'On the emulator', note: 'A note.', view: VIEW, brief: [{ label: 'Site', value: 'Connecting Ridge' }], created: '2026-11-12T00:00:00.000Z', expires: '2027-05-11T00:00:00.000Z', ...overrides })
const record = (planId: string, keyId = `k${unique()}`) => ({ id: keyId, plan: planId, fingerprint: 'f'.repeat(32), expires: '2026-11-13T00:00:00.000Z' })

describe.skipIf(!emulator)('plans on the Firestore emulator', () => {
  const store = firestorePlans(options, token)

  it('saves, opens, lists by owner and deletes a plan, as it did before keys existed', async () => {
    const owner = `owner-${unique()}`
    const first = plan({ owner, created: '2026-11-12T00:00:00.000Z' })
    const second = plan({ owner, created: '2026-11-12T00:00:01.000Z' })
    expect(await store.create(first)).toBe(true)
    expect(await store.create(second)).toBe(true)
    // An id that is taken is refused, with no key involved.
    expect(await store.create(first)).toBe(false)

    expect(await store.get(first.id)).toEqual({ ...first, created: '2026-11-12T00:00:00Z', expires: '2027-05-11T00:00:00Z' })
    expect(await store.get(newId(8))).toBeNull()
    expect((await store.pageByOwner(owner, { limit: 50 })).plans.map((item) => item.id)).toEqual([second.id, first.id])
    await store.remove(first.id)
    expect(await store.get(first.id)).toBeNull()
    await store.remove(first.id)
  })

  it('writes a plan and its key together, and reads the key back with a version', async () => {
    const saved = plan()
    const key = record(saved.id)
    expect(await store.create(saved, key)).toBe(true)
    expect((await store.get(saved.id))?.title).toBe('On the emulator')
    const kept = (await store.savedBy(key.id)) as KeptKey
    expect(kept).toMatchObject({ id: key.id, plan: saved.id, fingerprint: key.fingerprint, expires: '2026-11-13T00:00:00Z' })
    expect(kept.version).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await store.savedBy(`k${unique()}`)).toBeNull()
  })

  it('writes neither when the key is taken, and neither when the id is taken', async () => {
    const saved = plan()
    const key = record(saved.id)
    await store.create(saved, key)

    // The key is on record: the second plan must not be saved.
    const other = plan()
    expect(await store.create(other, { ...record(other.id), id: key.id })).toBe(false)
    expect(await store.get(other.id)).toBeNull()
    expect((await store.savedBy(key.id))?.plan).toBe(saved.id)

    // The id is taken: the second key must not be recorded.
    const fresh = record(saved.id)
    expect(await store.create(saved, fresh)).toBe(false)
    expect(await store.savedBy(fresh.id)).toBeNull()
  })

  it('replaces an expired key\'s record only when told exactly which record', async () => {
    const saved = plan()
    const key = record(saved.id)
    await store.create(saved, key)
    const kept = (await store.savedBy(key.id)) as KeptKey

    const next = plan()
    expect(await store.create(next, { ...record(next.id, key.id), replaces: '2001-01-01T00:00:00.000000Z' })).toBe(false)
    expect(await store.get(next.id)).toBeNull()
    expect(await store.create(next, { ...record(next.id, key.id), replaces: kept.version })).toBe(true)
    expect((await store.savedBy(key.id))?.plan).toBe(next.id)
    // The same replacement again finds a newer record, and is refused.
    const late = plan()
    expect(await store.create(late, { ...record(late.id, key.id), replaces: kept.version })).toBe(false)
    expect(await store.get(late.id)).toBeNull()
  })

  it('lets exactly one of many writes with the same key through, at once', async () => {
    const keyId = `k${unique()}`
    const plans = Array.from({ length: 12 }, () => plan())
    const results = await Promise.all(plans.map((item) => store.create(item, record(item.id, keyId))))
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = plans[results.indexOf(true)]
    expect((await store.savedBy(keyId))?.plan).toBe(winner.id)
    // Only the winner's plan exists.
    const found = await Promise.all(plans.map((item) => store.get(item.id)))
    expect(found.filter(Boolean).map((item) => item?.id)).toEqual([winner.id])
  })

  /**
   * The paged query, as the real database is sent it. The emulator does not enforce composite
   * indexes: it answers a query whether or not the index exists (seen: this test passes with no
   * index declared to it). So this proves the query is shaped right and pages correctly: the
   * filter, the two orders, the start after a (time, document) pair, the extra plan that says more
   * follow. It does not prove the index exists, matches the query, or is used. That is proved on
   * the real database with Query Explain (docs/ARCHITECTURE_PHASE_5.md, check (b)).
   */
  it('pages through more than 200 plans of one owner newest first, past a deleted marker and a plan saved in between', async () => {
    const owner = `owner-${unique()}`
    const start = Date.parse('2026-01-01T00:00:00Z')
    // 230 plans a second apart, and three saved in the same millisecond, which the id orders.
    const saved = [
      ...Array.from({ length: 230 }, (_, n) => plan({ owner, created: new Date(start + n * 1000).toISOString() })),
      ...Array.from({ length: 3 }, () => plan({ owner, created: new Date(start + 100_500).toISOString() })),
    ]
    // Someone else's plan in the middle, which must never show.
    await store.create(plan({ owner: `owner-${unique()}`, created: new Date(start + 50_000).toISOString() }))
    for (let n = 0; n < saved.length; n += 25) await Promise.all(saved.slice(n, n + 25).map((item) => store.create(item)))
    const expected = saved.toSorted(newestFirst).map((item) => item.id)

    const seen: string[] = []
    let after: PageStart | undefined
    let pages = 0
    for (;;) {
      const page = await store.pageByOwner(owner, { limit: 100, after })
      seen.push(...page.plans.map((item) => item.id))
      pages += 1
      if (!page.more) break
      const last = page.plans.at(-1) as Plan
      after = { created: last.created, id: last.id }
      if (pages === 1) {
        // Between the first and the second page: the marker's own plan is deleted, and a newer plan saved.
        await store.remove(last.id)
        await store.create(plan({ owner, created: new Date(start + 999_000).toISOString() }))
      }
    }
    expect(pages).toBe(3)
    expect(seen).toEqual(expected)
    // The marker is made of values, so it still works with the plan it names gone.
    expect(await store.get(expected[99])).toBeNull()
  })

  it('through the whole service: twelve identical saves at once make one plan, and a different plan under the key is refused', async () => {
    const app = createPlansApp({ dataDir, allowedOrigins: [], plans: store, version: 'test', dataVersion: null, revision: null })
    const key = `emulator-${unique()}-${unique()}`
    const body = { title: `Raced ${unique()}`, note: '', view: VIEW }
    const answers = await Promise.all(Array.from({ length: 12 }, (_, n) => app.request(save(body, { key, visitor: `203.0.113.${n}` }))))
    expect(answers.map((answer) => answer.status)).toEqual(Array(12).fill(201))
    const ids = await Promise.all(answers.map(idOf))
    expect(new Set(ids).size).toBe(1)
    expect(answers.filter((answer) => answer.headers.get('idempotent-replayed') === 'true')).toHaveLength(11)
    expect((await app.request(`${ORIGIN}/api/plans/${ids[0]}`)).status).toBe(200)
    expect((await app.request(save({ ...body, title: 'Not the same' }, { key, visitor: '203.0.113.99' }))).status).toBe(422)
  })
})
