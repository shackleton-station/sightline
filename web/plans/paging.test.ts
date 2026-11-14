import { describe, expect, it } from 'vitest'
import { newId } from '../shared/ids'
import { cursorOf, readCursor } from './cursor'
import { memoryPlans, newestFirst, type Plan, type PlanStore } from './store'
import { as, identity, ORIGIN, PROGRAMS, save, VIEW } from './testing'

/**
 * "My plans" in pages: GET /api/plans?limit=<n>&after=<next>, newest first (API.md, "List my plans").
 * The plans are put straight into the store, because saving 260 through the API would run into the
 * limit of 5 saves a minute. `identity` in testing.ts turns "token-of-ana" into the owner "owner-ana".
 */
const START = Date.parse('2026-01-01T00:00:00Z')
const DAY = 86_400_000

/** A plan of `owner`'s, saved `minutes` after START. */
const planAt = (owner: string, minutes: number, id = newId(8)): Plan => ({
  id,
  title: `Plan ${minutes}`,
  note: '',
  view: VIEW,
  brief: [],
  created: new Date(START + minutes * 60_000).toISOString(),
  expires: new Date(START + minutes * 60_000 + 180 * DAY).toISOString(),
  owner,
})

/** A memory store holding `count` of Ana's plans, a minute apart, and a few of Ben's in between. */
async function storeWith(count: number): Promise<{ store: PlanStore; hers: Plan[] }> {
  const store = memoryPlans()
  const hers = Array.from({ length: count }, (_, n) => planAt('owner-ana', n))
  for (const plan of hers) await store.create(plan)
  for (let n = 0; n < 5; n++) await store.create(planAt('owner-ben', n * 7 + 0.5))
  return { store, hers: hers.toSorted(newestFirst) }
}

interface Listed {
  status: number
  body: { plans?: { id: string; title: string; created: string; expires: string }[]; next?: string; error?: string }
}

describe.each(PROGRAMS)('my plans in pages, answered by $name', ({ site }) => {
  const list = async (app: ReturnType<typeof site>, query = '', who: string | null = 'token-of-ana'): Promise<Listed> => {
    const response = await app.request(as(who, new Request(`${ORIGIN}/api/plans${query}`)))
    return { status: response.status, body: (await response.json()) as Listed['body'] }
  }
  /** Every page from the first, following `next`, with `limit` per page. */
  const walk = async (app: ReturnType<typeof site>, limit: number) => {
    const pages: string[][] = []
    let next: string | undefined
    do {
      const { status, body } = await list(app, `?limit=${limit}${next ? `&after=${next}` : ''}`)
      expect(status).toBe(200)
      pages.push((body.plans ?? []).map((plan) => plan.id))
      next = body.next
    } while (next && pages.length < 50)
    return pages
  }

  it('without the new parameters, answers as it did before pages: the newest 50, in the same shape, plus `next` when there are more', async () => {
    const few = await storeWith(3)
    const small = await list(site({ identity, plans: few.store }))
    expect(small.status).toBe(200)
    // Three plans: exactly the old reply, with no `next`.
    expect(Object.keys(small.body)).toEqual(['plans'])
    expect(small.body.plans?.map((plan) => plan.id)).toEqual(few.hers.map((plan) => plan.id))
    expect(Object.keys(small.body.plans?.[0] ?? {}).sort()).toEqual(['created', 'expires', 'id', 'title'])

    const many = await storeWith(60)
    const first = await list(site({ identity, plans: many.store }))
    expect(first.body.plans?.map((plan) => plan.id)).toEqual(many.hers.slice(0, 50).map((plan) => plan.id))
    expect(first.body.next).toEqual(expect.any(String))
  })

  it('gives the next page from `next`, with no plan twice, and no `next` on the last page', async () => {
    const { store, hers } = await storeWith(25)
    const app = site({ identity, plans: store })
    const first = await list(app, '?limit=10')
    expect(first.body.plans?.map((plan) => plan.id)).toEqual(hers.slice(0, 10).map((plan) => plan.id))
    const second = await list(app, `?limit=10&after=${first.body.next}`)
    expect(second.body.plans?.map((plan) => plan.id)).toEqual(hers.slice(10, 20).map((plan) => plan.id))
    const last = await list(app, `?limit=10&after=${second.body.next}`)
    expect(last.body.plans?.map((plan) => plan.id)).toEqual(hers.slice(20).map((plan) => plan.id))
    expect('next' in last.body).toBe(false)

    // A page that ends exactly on the last plan has no `next` either: nothing would follow it.
    const exact = await list(app, `?limit=5&after=${second.body.next}`)
    expect(exact.body.plans).toHaveLength(5)
    expect('next' in exact.body).toBe(false)
  })

  it('reaches every one of more than 200 plans, newest first (the old list stopped at 200, in no order)', async () => {
    const { store, hers } = await storeWith(260)
    const app = site({ identity, plans: store })
    const pages = await walk(app, 100)
    expect(pages.map((page) => page.length)).toEqual([100, 100, 60])
    expect(pages.flat()).toEqual(hers.map((plan) => plan.id))
    // With the default page size too, and Ben's plans never among them.
    const byDefault: string[] = []
    let next: string | undefined
    do {
      const { body } = await list(app, next ? `?after=${next}` : '')
      byDefault.push(...(body.plans ?? []).map((plan) => plan.id))
      next = body.next
    } while (next)
    expect(byDefault).toEqual(hers.map((plan) => plan.id))
  })

  it('stays put when a plan is saved between two pages: nothing is skipped or shown twice, and the new plan is on the first page next time', async () => {
    const { store, hers } = await storeWith(30)
    let clock = START + 60 * 60_000
    const app = site({ identity, plans: store, now: () => (clock += 1000) })
    const first = await list(app, '?limit=10')
    const saved = await app.request(as('token-of-ana', save({ title: 'Saved in between', view: VIEW })))
    expect(saved.status).toBe(201)
    const { id } = (await saved.json()) as { id: string }

    const rest = await list(app, `?limit=100&after=${first.body.next}`)
    expect([...(first.body.plans ?? []), ...(rest.body.plans ?? [])].map((plan) => plan.id)).toEqual(hers.map((plan) => plan.id))
    expect((await list(app, '?limit=10')).body.plans?.[0].id).toBe(id)
  })

  it('carries on after the plan its marker points at has been deleted', async () => {
    const { store, hers } = await storeWith(30)
    const app = site({ identity, plans: store })
    const first = await list(app, '?limit=10')
    const markedPlan = hers[9]
    expect(readCursor(first.body.next ?? '')).toEqual({ created: markedPlan.created, id: markedPlan.id })
    const removed = await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans/${markedPlan.id}`, { method: 'DELETE', headers: { origin: ORIGIN } })))
    expect(removed.status).toBe(200)
    // The next plan after it is deleted too, and one further on: the page simply starts after them.
    await store.remove(hers[10].id)
    await store.remove(hers[15].id)
    const second = await list(app, `?limit=10&after=${first.body.next}`)
    expect(second.body.plans?.map((plan) => plan.id)).toEqual(hers.filter((_, n) => n >= 11 && n !== 15).slice(0, 10).map((plan) => plan.id))
  })

  it('keeps plans saved in the same millisecond in one fixed order, larger id first, and pages through them one at a time', async () => {
    const store = memoryPlans()
    const ids = ['bbbbbbbb', 'aaaaaaaa', 'cccccccc', 'zzzzzzzz']
    for (const id of ids) await store.create(planAt('owner-ana', 5, id))
    await store.create(planAt('owner-ana', 6, 'newerrrr'))
    await store.create(planAt('owner-ana', 4, 'tttttttt'))
    const pages = await walk(site({ identity, plans: store }), 1)
    expect(pages.flat()).toEqual(['newerrrr', 'zzzzzzzz', 'cccccccc', 'bbbbbbbb', 'aaaaaaaa', 'tttttttt'])
  })

  it('refuses a marker it did not write with 400 bad-cursor, before asking the database', async () => {
    let asked = 0
    const { store } = await storeWith(3)
    const app = site({ identity, plans: { ...store, pageByOwner: (owner, page) => (asked++, store.pageByOwner(owner, page)) } })
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const good = cursorOf({ created: '2026-01-01T00:00:00.000Z', id: 'abcdefgh' })
    for (const marker of [
      '',
      'x',
      '%%%',
      'not base64!',
      `${good}=`,
      encoded({ created: '2026-01-01T00:00:00.000Z', id: 'abcdefgh' }),
      encoded(['2026-01-01T00:00:00.000Z']),
      encoded(['2026-01-01T00:00:00.000Z', 'abcdefgh', 'extra']),
      encoded(['yesterday', 'abcdefgh']),
      encoded(['2026-13-45T99:00:00.000Z', 'abcdefgh']),
      encoded(['2026-01-01T00:00:00.000Z', 'ABCDEFGH']),
      encoded(['2026-01-01T00:00:00.000Z', 'owner-ana']),
      encoded([1767225600000, 'abcdefgh']),
      'a'.repeat(201),
    ]) {
      const { status, body } = await list(app, `?after=${encodeURIComponent(marker)}`)
      expect([marker, status, body]).toEqual([marker, 400, { error: 'bad-cursor' }])
    }
    expect(asked).toBe(0)
    expect((await list(app, `?after=${good}`)).status).toBe(200)
    expect(asked).toBe(1)
  })

  it('takes a page size from 1 to 100, and refuses anything else with 400 bad-limit', async () => {
    const { store, hers } = await storeWith(120)
    const app = site({ identity, plans: store })
    expect((await list(app, '?limit=1')).body.plans?.map((plan) => plan.id)).toEqual([hers[0].id])
    expect((await list(app, '?limit=100')).body.plans).toHaveLength(100)
    for (const limit of ['0', '101', '1000', '-1', '1.5', '1e2', 'ten', '', ' 5', '0x10']) {
      const { status, body } = await list(app, `?limit=${encodeURIComponent(limit)}`)
      expect([limit, status, body]).toEqual([limit, 400, { error: 'bad-limit' }])
    }
  })

  it('asks for sign-in first, whatever the parameters, and a marker never shows anyone else\'s plans', async () => {
    const { store } = await storeWith(30)
    const app = site({ identity, plans: store })
    expect((await list(app, '?limit=nonsense&after=nonsense', null)).status).toBe(401)

    const hers = await list(app, '?limit=10')
    // Only the last plan's time and id are in the marker: values Ana was just sent, and never whose plans they are.
    const marker = hers.body.next ?? ''
    expect(Buffer.from(marker, 'base64url').toString()).toBe(JSON.stringify([hers.body.plans?.[9].created, hers.body.plans?.[9].id]))
    expect(Buffer.from(marker, 'base64url').toString()).not.toContain('owner')
    // Ben sending Ana's marker gets his own plans that are older than that point, and nothing of hers.
    const his = await list(app, `?after=${marker}`, 'token-of-ben')
    expect(his.status).toBe(200)
    const benIds = new Set((await list(app, '', 'token-of-ben')).body.plans?.map((plan) => plan.id))
    for (const plan of his.body.plans ?? []) expect(benIds.has(plan.id)).toBe(true)
  })
})

describe('the order of my plans', () => {
  it('is newest first, then the larger id, read as times and not as text', () => {
    const at = (created: string, id: string) => ({ created, id })
    expect([at('2026-01-01T00:00:00.000Z', 'aaaaaaaa'), at('2026-01-02T00:00:00Z', 'aaaaaaaa'), at('2026-01-01T00:00:00Z', 'bbbbbbbb')].sort(newestFirst)).toEqual([
      at('2026-01-02T00:00:00Z', 'aaaaaaaa'),
      at('2026-01-01T00:00:00Z', 'bbbbbbbb'),
      at('2026-01-01T00:00:00.000Z', 'aaaaaaaa'),
    ])
    // Firestore writes "…00Z" for a time that `toISOString` writes "…00.000Z". Read as text they would sort differently.
    expect(newestFirst(at('2026-01-01T00:00:00Z', 'aaaaaaaa'), at('2026-01-01T00:00:00.500Z', 'aaaaaaaa'))).toBeGreaterThan(0)
  })

  it('reads back exactly the marker it wrote', () => {
    const start = { created: '2026-11-12T10:20:30.123456Z', id: 'k3m9p2qr' }
    expect(readCursor(cursorOf(start))).toEqual(start)
  })
})
