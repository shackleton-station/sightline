import { afterEach, describe, expect, it, vi } from 'vitest'
import { firestorePlans } from './firestorePlans'

/**
 * "My plans" before and after the index exists, with Firestore stood in for by a fake `fetch`.
 *
 * The emulator cannot show this: it answers every query whether or not an index exists. The real
 * database refuses the paged query until the index is ready, with HTTP 400 and a list holding one
 * error whose status is FAILED_PRECONDITION. That exact answer was seen on the live `plans` database
 * on 2026-11-12, before the index was declared, and is copied here (with the console link cut).
 */
const NO_INDEX = [{ error: { code: 400, message: 'The query requires an index. You can create it here: <link>', status: 'FAILED_PRECONDITION' } }]
const DATABASE = 'projects/demo/databases/plans'

interface Sent {
  structuredQuery: {
    where: unknown
    orderBy?: { field: { fieldPath: string }; direction: string }[]
    startAt?: { values: Record<string, string>[]; before: boolean }
    limit: number
  }
}

const row = (id: string, created: string) => ({
  document: { name: `${DATABASE}/documents/plans/${id}`, fields: { title: { stringValue: id }, created: { timestampValue: created }, expires: { timestampValue: '2027-06-01T00:00:00Z' }, owner: { stringValue: 'owner-ana' } } },
  readTime: '2026-11-12T00:00:00Z',
})
/** Ten of Ana's plans, a minute apart, in the order Firestore answers an equality filter alone: by id, not by time. */
const TEN = Array.from({ length: 10 }, (_, n) => row(`pqrs${'abcdefghjk'[n]}aaa`, `2026-11-01T00:${String(n).padStart(2, '0')}:00Z`))

describe('listing my plans from Firestore', () => {
  const sent: Sent[] = []
  const warned: string[] = []
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    sent.length = 0
    warned.length = 0
  })

  /** Firestore as a function of the query: `indexed` answers the ordered query, `plain` the old one. */
  function firestore(indexed: (query: Sent['structuredQuery']) => Response) {
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void warned.push(line))
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Sent
      sent.push(body)
      return body.structuredQuery.orderBy ? indexed(body.structuredQuery) : Response.json(TEN)
    })
    let clock = 0
    const store = firestorePlans({ project: 'demo', database: 'plans', now: () => clock }, () => Promise.resolve('token'))
    return { store, tick: (ms: number) => (clock += ms) }
  }

  it('asks the index for one page: owner, newest first, then the larger id, after the marker, one more than the page', async () => {
    const { store } = firestore(() => Response.json([row('newestaa', '2026-11-12T00:00:02Z'), row('nextaaaa', '2026-11-12T00:00:01Z'), row('thirdaaa', '2026-11-12T00:00:00Z')]))
    const page = await store.pageByOwner('owner-ana', { limit: 2, after: { created: '2026-11-13T00:00:00.000Z', id: 'markerid' } })
    expect(page.plans.map((plan) => plan.id)).toEqual(['newestaa', 'nextaaaa'])
    expect(page.more).toBe(true)
    expect(sent).toEqual([
      {
        structuredQuery: {
          from: [{ collectionId: 'plans' }],
          where: { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: 'owner-ana' } } },
          orderBy: [
            { field: { fieldPath: 'created' }, direction: 'DESCENDING' },
            { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
          ],
          startAt: { values: [{ timestampValue: '2026-11-13T00:00:00.000Z' }, { referenceValue: `${DATABASE}/documents/plans/markerid` }], before: false },
          limit: 3,
        },
      },
    ])
    expect(warned).toEqual([])
    // The last page: no more than asked for comes back, so nothing follows it.
    const last = await store.pageByOwner('owner-ana', { limit: 5 })
    expect([last.plans.length, last.more]).toEqual([3, false])
    expect(sent[1].structuredQuery.startAt).toBeUndefined()
  })

  it('while the index is missing, lists the old way, sorted here, with the same pages, says so in the log, and tries the index again a minute later', async () => {
    let ready = false
    const { store, tick } = firestore(() => (ready ? Response.json([row('fromindx', '2026-11-12T00:00:00Z')]) : Response.json(NO_INDEX, { status: 400 })))
    const first = await store.pageByOwner('owner-ana', { limit: 4 })
    const newest = TEN.map((item) => item.document.name.slice(-8)).toReversed()
    expect(first.plans.map((plan) => plan.id)).toEqual(newest.slice(0, 4))
    expect(first.more).toBe(true)
    // It tried the index, was refused, and asked the old query: at most 200, no order.
    expect(sent.map((item) => [Boolean(item.structuredQuery.orderBy), item.structuredQuery.limit])).toEqual([
      [true, 5],
      [false, 200],
    ])
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('not ready')

    // The next page, from the same marker the handler would make, without trying the index again.
    const last = first.plans[3]
    const second = await store.pageByOwner('owner-ana', { limit: 4, after: { created: last.created, id: last.id } })
    expect(second.plans.map((plan) => plan.id)).toEqual(newest.slice(4, 8))
    expect(sent).toHaveLength(3)

    // A minute on, the index is ready: it is used again, and the old way is not.
    ready = true
    tick(60_000)
    expect((await store.pageByOwner('owner-ana', { limit: 4 })).plans.map((plan) => plan.id)).toEqual(['fromindx'])
    expect(sent).toHaveLength(4)
    expect(warned).toHaveLength(1)
  })

  it('does not hide any other failure behind the old way', async () => {
    const { store } = firestore(() => Response.json([{ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }], { status: 403 }))
    await expect(store.pageByOwner('owner-ana', { limit: 4 })).rejects.toThrow('PERMISSION_DENIED')
    expect(sent).toHaveLength(1)
  })
})
