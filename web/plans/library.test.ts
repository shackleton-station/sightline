import { describe, expect, it } from 'vitest'
import { LIBRARY_FRESH_MS, type LibraryScenario, libraryOf, scenariosOf } from './library'
import { memoryPlans, type Plan } from './store'
import { as, identity, idOf, ORIGIN, PROGRAMS, save, VIEW } from './testing'

const plan = (over: Partial<Plan> = {}): Plan => ({ id: 'abcd2345', title: 'A plan', note: 'A note nobody else should read', view: VIEW, brief: [], created: '2026-11-15T10:00:00.000Z', expires: '2027-05-14T10:00:00.000Z', ...over })
const library = async (app: ReturnType<(typeof PROGRAMS)[number]['site']>) => ((await (await app.request(new Request(`${ORIGIN}/api/plans/library`))).json()) as { scenarios: LibraryScenario[] }).scenarios

describe('a plan taken apart into its scenarios', () => {
  it('reads the place and hour the view opens on: the month, and the hours into it', () => {
    // t=497 is 20 days and 17 hours into June.
    expect(scenariosOf(plan())).toEqual([{ saved: '2026-11-15T10:00:00.000Z', site: 'connecting-ridge', landing: '2027-06-21T17:00:00Z' }])
  })

  it('adds the scenarios kept beside it, in their order', () => {
    const view = '#a=connecting-ridge@2027-06&t=0&limits=14_72_72_1_1&mode=plan&list=shackleton-rim@2027-07-04T09~-89.5,120@2028-01-01T00'
    expect(scenariosOf(plan({ view })).map(({ site, landing }) => `${site} ${landing}`)).toEqual(['connecting-ridge 2027-06-01T00:00:00Z', 'shackleton-rim 2027-07-04T09:00:00Z', '-89.5,120 2028-01-01T00:00:00Z'])
  })

  it('sends nothing a visitor typed, and no id to open the plan with: not the title, not the note', () => {
    const sent = JSON.stringify(scenariosOf(plan({ title: 'Typed by a stranger' })))
    expect(sent).not.toContain('stranger')
    expect(sent).not.toContain('nobody else')
    expect(sent).not.toContain('abcd2345')
  })

  it('gives nothing for a view it cannot read', () => {
    expect(scenariosOf(plan({ view: '#nothing' }))).toEqual([])
  })

  it('leaves out the plans the deploy check saves, and keeps a plan that only mentions one', () => {
    const now = Date.parse('2026-11-15T12:00:00Z')
    const plans = [plan({ created: '2026-11-15T09:00:00.000Z', title: 'Deploy check (64805c1c)' }), plan({ created: '2026-11-15T10:00:00.000Z', title: 'After the deploy check' })]
    expect(libraryOf(plans, now).map((one) => one.saved)).toEqual(['2026-11-15T10:00:00.000Z'])
  })

  it('leaves out plans past their time', () => {
    const now = Date.parse('2026-11-15T12:00:00Z')
    const plans = [plan({ created: '2026-11-15T09:00:00.000Z' }), plan({ created: '2026-11-15T10:00:00.000Z', expires: '2026-11-15T11:00:00.000Z' })]
    expect(libraryOf(plans, now).map((one) => one.saved)).toEqual(['2026-11-15T09:00:00.000Z'])
  })
})

describe.each(PROGRAMS)('the library, answered by $name', ({ site }) => {
  it('lists a plan saved without signing in, and one saved signed in, to a visitor who is not signed in', async () => {
    const app = site({ identity })
    const first = await idOf(await app.request(save({ title: 'No sign-in', note: 'A note for one reader', view: VIEW })))
    const second = await idOf(await app.request(as('token-of-ana', save({ title: 'Signed in', view: VIEW }))))
    const listed = await library(app)
    expect(listed).toHaveLength(2)
    // Only the three things the service worked out: no title, no note, and no id that would open them.
    for (const one of listed) expect(Object.keys(one).toSorted()).toEqual(['landing', 'saved', 'site'])
    const sent = JSON.stringify(listed)
    for (const typed of ['No sign-in', 'Signed in', 'one reader', first, second]) expect(sent).not.toContain(typed)
  })

  it('still shows the title and the note to whoever opens the plan by its link', async () => {
    const app = site({ identity })
    const id = await idOf(await app.request(save({ title: 'For my team', note: 'Read before Friday', view: VIEW })))
    const opened = (await (await app.request(new Request(`${ORIGIN}/api/plans/${id}`))).json()) as { plan: Plan }
    expect([opened.plan.title, opened.plan.note]).toEqual(['For my team', 'Read before Friday'])
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
