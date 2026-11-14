/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attemptFor, LIST_PAGE, listPlans, loadPlan, type PlanLine, planFailure, planHash, planIdFrom, RETRY_AFTER_MS, savePlan, withPage } from './plans'

describe('shared plans, in the browser', () => {
  it('reads a plan id from an address, and only ids the server could have made', () => {
    expect(planIdFrom('#plan=abcd2345')).toBe('abcd2345')
    expect(planIdFrom(planHash('wxyz6789'))).toBe('wxyz6789')
    for (const hash of ['', '#how', '#plan=', '#plan=short', '#plan=ABCD2345', '#plan=abcd234l', '#plan=abcd2345&x=1', '#a=apollo-11@2027-05']) {
      expect(planIdFrom(hash)).toBeNull()
    }
  })

  it('explains a failure in plain words', () => {
    expect(planFailure(404, false)).toContain('no longer exists')
    expect(planFailure(503, true)).toContain("isn't switched on")
    expect(planFailure(502, true)).toContain("couldn't be saved")
    expect(planFailure(502, false)).toContain("couldn't be loaded")
    expect(planFailure(422, true)).toContain("couldn't be saved")
  })
})

describe('one key per attempt to save', () => {
  const plan = { title: 'Two weeks on the ridge', note: '', view: '#a=connecting-ridge@2027-06&t=497' }

  it('makes a new random key for a new attempt, in a form the server accepts', () => {
    const first = attemptFor(null, plan, false)
    expect(first.key).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(attemptFor(null, plan, false).key).not.toBe(first.key)
  })

  it('keeps the key when Save is pressed again with nothing changed, and changes it when anything is', () => {
    const first = attemptFor(null, plan, false)
    expect(attemptFor(first, { ...plan }, false)).toBe(first)
    for (const changed of [{ ...plan, title: 'Another name' }, { ...plan, note: 'A note now.' }, { ...plan, view: '#a=connecting-ridge@2027-07&t=3' }]) {
      expect(attemptFor(first, changed, false).key).not.toBe(first.key)
    }
    // Signing in changes whose plan it would be, so it is a different save.
    expect(attemptFor(first, plan, true).key).not.toBe(first.key)
  })
})

describe('saving with a key', () => {
  const plan = { title: 'T', note: '', view: '#a=connecting-ridge@2027-06&t=497' }
  const real = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real
  })

  /** Answers each request in turn with the next of `answers`; an Error is a connection that failed. */
  function server(...answers: (Response | Error)[]) {
    const keys: (string | null)[] = []
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('idempotency-key'))
      const next = answers.shift() ?? new Error('no more answers')
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    }
    return keys
  }
  const waits: number[] = []
  const wait = (ms: number) => {
    waits.push(ms)
    return Promise.resolve()
  }

  it('tries once more, with the same key, when the answer was lost or left the save in doubt', async () => {
    for (const lost of [new Error('connection reset'), Response.json({ error: 'upstream' }, { status: 502 }), new Response('gateway timeout', { status: 504 })]) {
      waits.length = 0
      const keys = server(lost, Response.json({ id: 'abcd2345' }, { status: 201 }))
      expect(await savePlan(plan, 'the-key-of-this-attempt', wait)).toEqual({ ok: true, value: 'abcd2345' })
      expect(keys).toEqual(['"the-key-of-this-attempt"', '"the-key-of-this-attempt"'])
      expect(waits).toEqual([RETRY_AFTER_MS])
    }
  })

  it('tries only once more, and does not retry an answer that says no', async () => {
    let keys = server(new Error('offline'), new Error('offline'), Response.json({ id: 'abcd2345' }, { status: 201 }))
    expect(await savePlan(plan, 'the-key-of-this-attempt', wait)).toMatchObject({ ok: false, message: expect.stringContaining("Couldn't reach the server") })
    expect(keys).toHaveLength(2)

    for (const status of [400, 403, 422, 429, 500, 503]) {
      keys = server(Response.json({ error: 'no' }, { status }), Response.json({ id: 'abcd2345' }, { status: 201 }))
      expect(await savePlan(plan, 'the-key-of-this-attempt', wait)).toMatchObject({ ok: false, status })
      expect(keys).toHaveLength(1)
    }
  })

  it('never retries without a key, because a retry could then save twice', async () => {
    const keys = server(new Error('connection reset'), Response.json({ id: 'abcd2345' }, { status: 201 }))
    const spy = vi.fn(wait)
    expect((await savePlan(plan, undefined, spy)).ok).toBe(false)
    expect(keys).toEqual([null])
    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * The pages' half of the agreement in web/plans/API.md. The service's half is checked in
 * web/plans/contract.test.ts. The pages and the service are deployed apart, so each must cope with
 * the other being a version ahead or behind.
 */
describe("the pages' side of the plans contract", () => {
  const VIEW = '#a=connecting-ridge@2027-06&t=497'
  const described = [...readFileSync(fileURLToPath(new URL('../../plans/API.md', import.meta.url)), 'utf8').matchAll(/```json contract\n([\s\S]*?)```/g)].map(
    ([, block]) => JSON.parse(block) as { operation: string; request: { headers?: Record<string, string>; body?: Record<string, string> } },
  )
  const saving = described.find((item) => item.operation === 'save')
  const real = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real
  })

  /** Answers the page's next request with `body`, and keeps what the page sent. */
  function answering(status: number, body: unknown) {
    const sent: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), init })
      return Promise.resolve(Response.json(body, { status }))
    }
    return sent
  }

  it('sends only the fields and headers the description lists, with a key in the described form', async () => {
    const sent = answering(201, { id: 'abcd2345' })
    expect(await savePlan({ title: 'T', note: 'N', view: VIEW }, 'a-key-made-by-the-page')).toEqual({ ok: true, value: 'abcd2345' })
    expect([sent[0].init?.method, sent[0].url]).toEqual(['POST', '/api/plans'])

    const plain = (names: Record<string, string> | undefined) => Object.keys(names ?? {}).map((name) => name.replace(/\?$/, ''))
    for (const field of Object.keys(JSON.parse(String(sent[0].init?.body)) as object)) expect(plain(saving?.request.body)).toContain(field)
    const headers = new Headers(sent[0].init?.headers)
    // The browser adds the origin itself. Everything the page sets must be described.
    for (const name of headers.keys()) expect(plain(saving?.request.headers)).toContain(name)
    expect(headers.get('idempotency-key')).toBe('"a-key-made-by-the-page"')
  })

  it('ignores reply fields it does not know, so an older page can call a newer service', async () => {
    const plan = { id: 'abcd2345', title: 'T', note: '', view: VIEW, brief: [], created: '2026-11-12T00:00:00.000Z', expires: '2027-05-11T00:00:00.000Z', a_field_added_next_year: 1 }
    answering(200, { plan, mine: false, also_new: true })
    expect(await loadPlan('abcd2345')).toMatchObject({ ok: true, value: { mine: false, plan: { id: 'abcd2345', view: VIEW } } })
    answering(201, { id: 'abcd2345', replayed: true })
    expect(await savePlan({ title: 'T', note: '', view: VIEW }, 'another-key-from-the-page')).toEqual({ ok: true, value: 'abcd2345' })
  })
})

/** The share dialog's list of one's own plans, a page at a time (web/plans/API.md, "List my plans"). */
describe('my plans, a page at a time', () => {
  const line = (id: string): PlanLine => ({ id, title: `Plan ${id}`, created: '2026-11-12T00:00:00.000Z', expires: '2027-05-11T00:00:00.000Z' })
  const listing = [...readFileSync(fileURLToPath(new URL('../../plans/API.md', import.meta.url)), 'utf8').matchAll(/```json contract\n([\s\S]*?)```/g)]
    .map(([, block]) => JSON.parse(block) as { operation: string; request: { headers?: Record<string, string>; query?: Record<string, string> } })
    .find((item) => item.operation === 'list')
  const real = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real
  })

  /** Answers each request with the next of `answers`, and keeps the addresses asked for. */
  function server(...answers: Response[]) {
    const asked: { url: string; headers: Headers }[] = []
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), headers: new Headers(init?.headers) })
      return Promise.resolve(answers.shift() ?? Response.json({ error: 'upstream' }, { status: 502 }))
    }
    return asked
  }

  it('asks for the first page, then the next with the marker it was given, sent back unchanged', async () => {
    const asked = server(Response.json({ plans: [line('abcd2345')], next: 'WyJhIiwiYiJd_-x' }), Response.json({ plans: [line('wxyz6789')] }))
    expect(await listPlans()).toEqual({ ok: true, value: { plans: [line('abcd2345')], next: 'WyJhIiwiYiJd_-x' } })
    expect(await listPlans('WyJhIiwiYiJd_-x')).toEqual({ ok: true, value: { plans: [line('wxyz6789')], next: null } })
    expect(asked.map((item) => item.url)).toEqual([`/api/plans?limit=${LIST_PAGE}`, `/api/plans?limit=${LIST_PAGE}&after=WyJhIiwiYiJd_-x`])
  })

  it('sends only the query parameters and headers the description lists, and a page size the service accepts', async () => {
    const asked = server(Response.json({ plans: [] }))
    await listPlans('a-marker')
    const plain = (names: Record<string, string> | undefined) => Object.keys(names ?? {}).map((name) => name.replace(/\?$/, ''))
    for (const name of new URL(asked[0].url, 'https://example.org').searchParams.keys()) expect(plain(listing?.request.query)).toContain(name)
    for (const name of asked[0].headers.keys()) expect(plain(listing?.request.headers)).toContain(name)
    expect(LIST_PAGE).toBeGreaterThanOrEqual(1)
    expect(LIST_PAGE).toBeLessThanOrEqual(100)
  })

  it('reads an older service, which ignores the parameters and sends no `next`, as one page; and ignores fields it does not know', async () => {
    server(Response.json({ plans: [line('abcd2345'), line('wxyz6789')] }), Response.json({ plans: [line('abcd2345')], next: '', cursor_v2: 'x', total: 9 }))
    expect(await listPlans()).toEqual({ ok: true, value: { plans: [line('abcd2345'), line('wxyz6789')], next: null } })
    expect(await listPlans()).toEqual({ ok: true, value: { plans: [line('abcd2345')], next: null } })
  })

  it('explains a refused page in words for a list, not for a save', async () => {
    server(Response.json({ error: 'bad-cursor' }, { status: 400 }))
    const refused = await listPlans('stale')
    expect(refused.ok).toBe(false)
    expect(refused.ok ? '' : refused.message).toContain("couldn't be loaded")
  })

  it('adds a further page under the plans shown, never showing one twice', () => {
    expect(withPage([line('abcd2345'), line('bcde3456')], [line('bcde3456'), line('cdef4567')]).map((plan) => plan.id)).toEqual(['abcd2345', 'bcde3456', 'cdef4567'])
    expect(withPage([], [line('abcd2345')])).toEqual([line('abcd2345')])
  })
})
