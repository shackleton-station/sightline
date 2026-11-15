import { describe, expect, it } from 'vitest'
import { LIBRARY_FRESH_MS, type LibraryScenario, libraryOf, scenariosOf } from './library'
import { memoryPlans, type Plan } from './store'
import { as, identity, idOf, ORIGIN, PROGRAMS, save, VIEW } from './testing'

const plan = (over: Partial<Plan> = {}): Plan => ({ id: 'abcd2345', title: 'A plan', note: 'A note nobody else should read', view: VIEW, brief: [], created: '2026-11-15T10:00:00.000Z', expires: '2027-05-14T10:00:00.000Z', ...over })
const library = async (app: ReturnType<(typeof PROGRAMS)[number]['site']>) => ((await (await app.request(new Request(`${ORIGIN}/api/plans/library`))).json()) as { scenarios: LibraryScenario[] }).scenarios

describe('a plan taken apart into its scenarios', () => {
  it('reads the place and hour the view opens on: the month, and the hours into it', () => {
    // t=497 is 20 days and 17 hours into June.
    expect(scenariosOf(plan())).toEqual([{ plan: 'abcd2345', title: 'A plan', saved: '2026-11-15T10:00:00.000Z', site: 'connecting-ridge', landing: '2027-06-21T17:00:00Z' }])
  })

  it('adds the scenarios kept beside it, in their order', () => {
    const view = '#a=connecting-ridge@2027-06&t=0&limits=14_72_72_1_1&mode=plan&list=shackleton-rim@2027-07-04T09~-89.5,120@2028-01-01T00'
    expect(scenariosOf(plan({ view })).map(({ site, landing }) => `${site} ${landing}`)).toEqual(['connecting-ridge 2027-06-01T00:00:00Z', 'shackleton-rim 2027-07-04T09:00:00Z', '-89.5,120 2028-01-01T00:00:00Z'])
  })

  it('never sends the note, and gives nothing for a view it cannot read', () => {
    expect(JSON.stringify(scenariosOf(plan()))).not.toContain('nobody else')
    expect(scenariosOf(plan({ view: '#nothing' }))).toEqual([])
  })

  it('leaves out private plans and plans past their time', () => {
    const now = Date.parse('2026-11-15T12:00:00Z')
    const plans = [plan({ id: 'aaaa2222' }), plan({ id: 'bbbb2222', private: true, owner: 'owner-ana' }), plan({ id: 'cccc2222', expires: '2026-11-15T11:00:00.000Z' })]
    expect(libraryOf(plans, now).map((one) => one.plan)).toEqual(['aaaa2222'])
  })
})

describe.each(PROGRAMS)('the library, answered by $name', ({ site }) => {
  it('lists a plan saved without signing in, and one saved signed in, to a visitor who is not signed in', async () => {
    const app = site({ identity })
    const first = await idOf(await app.request(save({ title: 'No sign-in', view: VIEW })))
    const second = await idOf(await app.request(as('token-of-ana', save({ title: 'Signed in', view: VIEW }))))
    expect((await library(app)).map((one) => one.plan).toSorted()).toEqual([first, second].toSorted())
  })

  it('keeps a private plan out, while its link still opens it', async () => {
    const app = site({ identity })
    const id = await idOf(await app.request(as('token-of-ana', save({ title: 'Mine alone', view: VIEW, private: true }))))
    expect(await library(app)).toEqual([])
    expect((await app.request(new Request(`${ORIGIN}/api/plans/${id}`))).status).toBe(200)
  })

  it('lists a plan marked private by a visitor who is not signed in: nobody could ever delete it', async () => {
    const app = site({ identity })
    const id = await idOf(await app.request(save({ title: 'Not signed in', view: VIEW, private: true })))
    expect((await library(app)).map((one) => one.plan)).toEqual([id])
  })

  it('reads a private save and a listed save under one key as different plans', async () => {
    const app = site({ identity })
    const key = 'library-test-key-0001'
    await app.request(as('token-of-ana', save({ title: 'Same', view: VIEW }, { key })))
    expect((await app.request(as('token-of-ana', save({ title: 'Same', view: VIEW, private: true }, { key })))).status).toBe(422)
  })

  it('drops a deleted plan at once, and reads the database once while what it holds is fresh', async () => {
    let clock = Date.parse('2026-11-15T12:00:00Z')
    const plans = memoryPlans()
    let reads = 0
    const counted = { ...plans, newest: (limit: number) => (reads++, plans.newest(limit)) }
    const app = site({ identity, plans: counted, now: () => clock })
    const id = await idOf(await app.request(as('token-of-ana', save({ title: 'Going', view: VIEW }))))
    expect(await library(app)).toHaveLength(1)
    await library(app)
    expect(reads).toBe(1)
    await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans/${id}`, { method: 'DELETE', headers: { origin: ORIGIN } })))
    expect(await library(app)).toEqual([])
    clock += LIBRARY_FRESH_MS + 1
    await library(app)
    expect(reads).toBe(3)
  })
})
