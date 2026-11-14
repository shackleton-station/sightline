import { describe, expect, it } from 'vitest'
import { memoryPlans } from './store'
import { as, identity, idOf, ORIGIN, PROGRAMS, save, VIEW } from './testing'

describe.each(PROGRAMS)('shared mission plans, answered by $name', ({ site }) => {
  it('saves a plan with a brief worked out from the data, and opens it again by its id', async () => {
    const app = site({ now: () => Date.parse('2026-11-12T00:00:00Z') })
    const saved = await app.request(save({ title: '  Two weeks   on the ridge ', note: 'Lands as the window opens.', view: VIEW }))
    expect(saved.status).toBe(201)
    const { id } = (await saved.json()) as { id: string }
    expect(id).toMatch(/^[a-hj-km-np-z2-9]{8}$/)

    const opened = await app.request(`${ORIGIN}/api/plans/${id}`)
    expect(opened.status).toBe(200)
    const { plan } = (await opened.json()) as { plan: { title: string; view: string; brief: { label: string; value: string }[]; created: string; expires: string } }
    expect(plan).toMatchObject({ title: 'Two weeks on the ridge', note: 'Lands as the window opens.', view: VIEW, created: '2026-11-12T00:00:00.000Z', expires: '2027-05-11T00:00:00.000Z' })
    // The brief comes from the same functions as the page: this hour is the opening of a landing window.
    const brief = Object.fromEntries(plan.brief.map((item) => [item.label, item.value]))
    expect(brief).toMatchObject({ Site: 'Connecting Ridge', Time: '21 June 2027, 17:00 UTC', 'A landing at this hour': 'meets the limits', Month: 'June 2027' })
    expect(brief['Checked against']).toContain('14-day mission')
  })

  it('keeps what the Sightline screen adds to a view: the slope limit, the heights, the scenario on show, landing accuracy, the skyline, the Planner\'s tab and the open panel', async () => {
    const app = site()
    const whole = `${VIEW}&slope=8&hp=5&ha=10&sc=1&acc=250&accs=1.5&accd=40&sky=1&planner=compare&panel=compare`
    const saved = await app.request(save({ title: 'The whole screen', view: `${whole}&evil=<script>&hp=7` }))
    expect(saved.status).toBe(201)
    const { id } = (await saved.json()) as { id: string }
    expect(((await (await app.request(`${ORIGIN}/api/plans/${id}`)).json()) as { plan: { view: string } }).plan.view).toBe(whole)
  })

  it('keeps the mark of a plan saved from the Sightline screen, and adds none to a plan from an older page', async () => {
    const app = site()
    const marked = await app.request(save({ title: 'From the Sightline screen', view: `${VIEW}&panel=compare&sl=1` }))
    const older = await app.request(save({ title: 'From an older page', view: `${VIEW}&b=shackleton-rim@2027-06&sl=yes` }))
    const view = async (response: Response) => ((await (await app.request(`${ORIGIN}/api/plans/${((await response.json()) as { id: string }).id}`)).json()) as { plan: { view: string } }).plan.view
    expect(await view(marked)).toBe(`${VIEW}&panel=compare&sl=1`)
    const kept = await view(older)
    expect(kept).toContain('b=shackleton-rim@2027-06')
    expect(kept).toContain('view=3d')
    expect(kept).not.toContain('sl=')
  })

  it('returns a plan stored before today as it was stored: nothing is rewritten on read', async () => {
    const plans = memoryPlans()
    // As the service stored views before it kept the Sightline screen's values: a panel that is no panel now, and no mark.
    const stored = { id: 'abcdefgh', title: 'An older plan', note: '', view: `${VIEW}&panel=mission`, brief: [{ label: 'Site', value: 'Connecting Ridge' }], created: '2026-11-01T00:00:00.000Z', expires: '2027-04-30T00:00:00.000Z' }
    await plans.create(stored)
    const app = site({ plans, now: () => Date.parse('2026-11-14T00:00:00Z') })
    const opened = await app.request(`${ORIGIN}/api/plans/abcdefgh`)
    expect(opened.status).toBe(200)
    expect(((await opened.json()) as { plan: typeof stored }).plan).toMatchObject(stored)
  })

  it('stores only views the app can open, rewritten by the server', async () => {
    const app = site()
    const junk = await app.request(save({ title: 'x', view: `${VIEW}&evil=<script>` }))
    const { id } = (await junk.json()) as { id: string }
    expect(((await (await app.request(`${ORIGIN}/api/plans/${id}`)).json()) as { plan: { view: string } }).plan.view).toBe(VIEW)

    const custom = await app.request(save({ title: 'A spot of my own', view: '#a=-89.46,-137.2@2027-05&t=100&limits=14_72_72_1_1&mode=plan' }))
    expect(custom.status).toBe(201)

    for (const body of [
      { title: '', view: VIEW },
      { title: 'x'.repeat(81), view: VIEW },
      { title: 'ok', note: 'x'.repeat(401), view: VIEW },
      { title: 'ok', view: '#a=mars-base@2027-05&t=0' },
      { title: 'ok', view: 'https://evil.example' },
      { title: 'ok' },
      'plan',
    ]) {
      expect((await app.request(save(body, { visitor: `198.51.100.${Math.floor(Math.random() * 250)}` }))).status).toBe(400)
    }
  })

  it('refuses other sites, limits saving to 5 a minute per visitor, and never asks the database for an impossible id', async () => {
    let asked = 0
    const plans = memoryPlans()
    const app = site({ plans: { ...plans, get: (id: string) => (asked++, plans.get(id)) }, now: () => 0 })
    expect((await app.request(save({ title: 'x', view: VIEW }, { origin: 'https://evil.example' }))).status).toBe(403)
    for (let i = 0; i < 5; i++) expect((await app.request(save({ title: 'x', view: VIEW }))).status).toBe(201)
    expect((await app.request(save({ title: 'x', view: VIEW }))).status).toBe(429)

    expect((await app.request(`${ORIGIN}/api/plans/abcdefgh`)).status).toBe(404)
    expect(asked).toBe(1)
    for (const id of ['ABCDEFGH', 'short', '../secret', 'abcdefg1']) expect((await app.request(`${ORIGIN}/api/plans/${id}`)).status).toBe(404)
    expect(asked).toBe(1)
    expect((await app.request(`${ORIGIN}/api/plans/abcdefgh`, { method: 'PUT' })).status).toBe(405)
  })

  describe('with sign-in', () => {
    const remove = (id: string, who: string | null, origin = ORIGIN) => as(who, new Request(`${ORIGIN}/api/plans/${id}`, { method: 'DELETE', headers: { origin } }))

    it('gives a plan to whoever saved it signed in, and never says who that is', async () => {
      let clock = Date.parse('2026-11-12T00:00:00Z')
      const app = site({ identity, now: () => (clock += 1000) })
      const first = await idOf(await app.request(as('token-of-ana', save({ title: 'First', view: VIEW }))))
      const second = await idOf(await app.request(as('token-of-ana', save({ title: 'Second', view: VIEW }))))
      const anonymous = await idOf(await app.request(save({ title: "Nobody's", view: VIEW })))
      await app.request(as('token-of-ben', save({ title: "Ben's", view: VIEW })))

      // Her list: her plans only, newest first, and only what a list needs.
      const listed = (await (await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans`)))).json()) as { plans: Record<string, string>[] }
      expect(listed.plans.map((plan) => [plan.id, plan.title])).toEqual([
        [second, 'Second'],
        [first, 'First'],
      ])
      expect(Object.keys(listed.plans[0]).sort()).toEqual(['created', 'expires', 'id', 'title'])

      // Anyone can open a plan by its link; only its owner is told it is theirs.
      const hers = (await (await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans/${first}`)))).json()) as { plan: object; mine: boolean }
      expect(hers.mine).toBe(true)
      for (const who of ['token-of-ben', null]) {
        const body = (await (await app.request(as(who, new Request(`${ORIGIN}/api/plans/${first}`)))).json()) as { plan: object; mine: boolean }
        expect(body.mine).toBe(false)
        expect(JSON.stringify(body)).not.toContain('owner')
      }
      expect(((await (await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans/${anonymous}`)))).json()) as { mine: boolean }).mine).toBe(false)
    })

    it('lets only the owner delete a plan', async () => {
      const app = site({ identity })
      const hers = await idOf(await app.request(as('token-of-ana', save({ title: 'Hers', view: VIEW }))))
      const nobodys = await idOf(await app.request(save({ title: "Nobody's", view: VIEW })))

      expect((await app.request(remove(hers, null))).status).toBe(401)
      expect((await app.request(remove(hers, 'token-of-ben'))).status).toBe(403)
      expect((await app.request(remove(hers, 'token-of-ana', 'https://evil.example'))).status).toBe(403)
      // A plan saved without signing in belongs to nobody, so nobody can delete it.
      expect((await app.request(remove(nobodys, 'token-of-ana'))).status).toBe(403)
      expect((await app.request(`${ORIGIN}/api/plans/${hers}`)).status).toBe(200)

      expect(await (await app.request(remove(hers, 'token-of-ana'))).json()).toEqual({ deleted: hers })
      expect((await app.request(`${ORIGIN}/api/plans/${hers}`)).status).toBe(404)
      expect((await app.request(remove(hers, 'token-of-ana'))).status).toBe(404)
    })

    it('refuses a token that does not check out instead of quietly saving an ownerless plan', async () => {
      const app = site({ identity })
      expect((await app.request(as('expired-or-forged', save({ title: 'x', view: VIEW })))).status).toBe(401)
      expect((await app.request(as('expired-or-forged', new Request(`${ORIGIN}/api/plans`)))).status).toBe(401)
      expect((await app.request(new Request(`${ORIGIN}/api/plans`))).status).toBe(401)
      // With sign-in switched off, a token means nothing: the list is closed and saving stays anonymous.
      const off = site()
      expect((await off.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans`)))).status).toBe(401)
      expect((await off.request(as('token-of-ana', save({ title: 'x', view: VIEW })))).status).toBe(401)
      expect((await off.request(save({ title: 'x', view: VIEW }))).status).toBe(201)
    })
  })

  it('says so when no database is configured', async () => {
    const app = site({ plans: null })
    const refused = await app.request(save({ title: 'x', view: VIEW }))
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'not-configured' })
  })
})
