import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createPlansApp } from './app'
import { memoryPlans } from './store'
import { as, dataDir, identity, idOf, ORIGIN, PROGRAMS, save, VIEW } from './testing'

/**
 * The contract test: the written description of the plans API (API.md) checked against the code.
 *
 * API.md holds one block per operation, listing every reply and the shape of its body. For each
 * reply this file has a scenario that makes the real handler give it, and the body is compared
 * with the written shape, both ways: every field the description promises is there with the
 * promised type, and the service sends no field the description leaves out. So a field cannot be
 * added, renamed or removed in the code without this file or API.md changing with it, and the diff
 * of API.md is where a reviewer sees whether the change was additive.
 *
 * The pages' half of the agreement (send only what is described, ignore reply fields they do not
 * know) is checked beside the pages' own code, in src/lib/plans.test.ts.
 */
interface Reply {
  body: unknown
  headers?: Record<string, string>
}
interface Operation {
  operation: string
  method: string
  path: string
  request: { headers?: Record<string, string>; body?: Record<string, string>; query?: Record<string, string> }
  replies: Record<string, Reply>
}

const described: Operation[] = [...readFileSync(new URL('./API.md', import.meta.url), 'utf8').matchAll(/```json contract\n([\s\S]*?)```/g)].map(([, block]) => JSON.parse(block) as Operation)
const operation = (name: string) => {
  const found = described.find((item) => item.operation === name)
  if (!found) throw new Error(`API.md does not describe "${name}"`)
  return found
}

const ID = /^[a-hj-km-np-z2-9]{8}$/
const KINDS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  'string|null': (value) => value === null || typeof value === 'string',
  boolean: (value) => typeof value === 'boolean',
  number: (value) => typeof value === 'number',
  time: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value),
  id: (value) => typeof value === 'string' && ID.test(value),
}

/** Every way `value` differs from the written `shape`, as lines of text. None means it matches. */
function differences(value: unknown, shape: unknown, at = 'body'): string[] {
  if (typeof shape === 'string') {
    if (shape.startsWith('=')) return String(value) === shape.slice(1) ? [] : [`${at} is ${JSON.stringify(value)}, described as exactly "${shape.slice(1)}"`]
    return KINDS[shape]?.(value) ? [] : [`${at} is ${JSON.stringify(value)}, described as ${shape}`]
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${at} is not a list`]
    return value.flatMap((item, n) => differences(item, shape[0], `${at}[${n}]`))
  }
  if (typeof value !== 'object' || value === null) return [`${at} is not an object`]
  const fields = shape as Record<string, unknown>
  const got = value as Record<string, unknown>
  const names = Object.keys(fields).map((name) => name.replace(/\?$/, ''))
  return [
    // The additive rule's two halves: nothing promised is missing, and nothing is sent unannounced.
    ...Object.entries(fields).flatMap(([name, inner]) => {
      const plain = name.replace(/\?$/, '')
      if (!(plain in got)) return name.endsWith('?') ? [] : [`${at}.${plain} is missing`]
      return differences(got[plain], inner, `${at}.${plain}`)
    }),
    ...Object.keys(got)
      .filter((name) => !names.includes(name))
      .map((name) => `${at}.${name} is sent but not described in API.md`),
  ]
}

const KEY = 'contract-test-key-0001'
const PLAN = { title: 'A plan for the contract', note: 'With a note.', view: VIEW }
const open = (id: string, who: string | null = null) => as(who, new Request(`${ORIGIN}/api/plans/${id}`))
const remove = (id: string, who: string | null, origin = ORIGIN) => as(who, new Request(`${ORIGIN}/api/plans/${id}`, { method: 'DELETE', headers: { origin } }))

describe.each(PROGRAMS)('the plans API as API.md describes it, answered by $name', ({ site }) => {
  /** One scenario per reply in API.md: "<operation> <reply>" to the real answer. */
  const scenarios: Record<string, () => Response | Promise<Response>> = {
    'save 201': () => site().request(save(PLAN)),
    'save 201 replayed': async () => {
      const app = site()
      await app.request(save(PLAN, { key: KEY }))
      return app.request(save(PLAN, { key: KEY }))
    },
    'save 400 bad-plan': () => site().request(save({ ...PLAN, title: '' })),
    'save 400 bad-key': () => site().request(save(PLAN, { key: 'short' })),
    'save 401': () => site({ identity }).request(as('expired-or-forged', save(PLAN))),
    'save 403': () => site().request(save(PLAN, { origin: 'https://evil.example' })),
    'save 422': async () => {
      const app = site()
      await app.request(save(PLAN, { key: KEY }))
      return app.request(save({ ...PLAN, title: 'Something else' }, { key: KEY }))
    },
    'open 200': async () => {
      const app = site({ identity })
      return app.request(open(await idOf(await app.request(as('token-of-ana', save(PLAN)))), 'token-of-ana'))
    },
    'open 404': () => site().request(open('abcdefgh')),
    'list 200': async () => {
      // Two plans and a page of one, so the reply carries `next` and its shape is checked too.
      const app = site({ identity })
      await app.request(as('token-of-ana', save(PLAN)))
      await app.request(as('token-of-ana', save(PLAN)))
      return app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans?limit=1`)))
    },
    'list 400 bad-limit': () => site({ identity }).request(as('token-of-ana', new Request(`${ORIGIN}/api/plans?limit=500`))),
    'list 400 bad-cursor': () => site({ identity }).request(as('token-of-ana', new Request(`${ORIGIN}/api/plans?after=not-a-marker`))),
    'list 401': () => site({ identity }).request(new Request(`${ORIGIN}/api/plans`)),
    'library 200': async () => {
      // One plan saved, so the list holds a scenario and its shape is checked too.
      const app = site()
      await app.request(save(PLAN))
      return app.request(new Request(`${ORIGIN}/api/plans/library`))
    },
    'delete 200': async () => {
      const app = site({ identity })
      return app.request(remove(await idOf(await app.request(as('token-of-ana', save(PLAN)))), 'token-of-ana'))
    },
    'delete 401': () => site({ identity }).request(remove('abcdefgh', null)),
    'delete 403 origin': () => site({ identity }).request(remove('abcdefgh', 'token-of-ana', 'https://evil.example')),
    'delete 403 not-yours': async () => {
      const app = site({ identity })
      return app.request(remove(await idOf(await app.request(as('token-of-ana', save(PLAN)))), 'token-of-ben'))
    },
    'delete 404': () => site({ identity }).request(remove('abcdefgh', 'token-of-ana')),
    'other-method 405': () => site().request(new Request(`${ORIGIN}/api/plans/abcdefgh`, { method: 'PUT' })),
  }

  // The status address belongs to the plans service alone; it is checked below.
  const shared = described.filter((item) => item.operation !== 'status' && item.operation !== 'status-for-web')

  it('has a scenario for every reply the description lists, and describes every scenario', () => {
    const listed = shared.flatMap((item) => Object.keys(item.replies).map((reply) => `${item.operation} ${reply}`))
    expect(Object.keys(scenarios).toSorted()).toEqual(listed.toSorted())
  })

  it.each(Object.keys(scenarios))('%s: the status, the body and the headers are as described', async (name) => {
    const [operationName, ...rest] = name.split(' ')
    const reply = operation(operationName).replies[rest.join(' ')]
    const response = await scenarios[name]()
    expect(response.status).toBe(Number(rest[0]))
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(differences(await response.json(), reply.body)).toEqual([])
    for (const [header, value] of Object.entries(reply.headers ?? {})) expect(response.headers.get(header)).toBe(value.replace(/^=/, ''))
  })

  it('ignores request fields and headers it does not know (the rule that lets a newer page call an older service)', async () => {
    const request = save({ ...PLAN, a_field_added_next_year: { nested: true }, tags: ['x'] })
    request.headers.set('x-a-header-added-next-year', '1')
    const response = await site().request(request)
    expect(response.status).toBe(201)
    expect(differences(await response.json(), operation('save').replies['201'].body)).toEqual([])
  })

  it('sends the optional `next` in the list scenario, so its described type is really checked, and none without a further page', async () => {
    expect(await (await scenarios['list 200']()).json()).toHaveProperty('next', expect.any(String))
    const app = site({ identity })
    await app.request(as('token-of-ana', save(PLAN)))
    const older = await app.request(as('token-of-ana', new Request(`${ORIGIN}/api/plans`)))
    // The request an older page sends, with no query: the reply it always had, nothing added.
    expect(Object.keys((await older.json()) as object)).toEqual(['plans'])
  })

  it('answers the three replies any operation can give as described: busy, upstream and not configured', async () => {
    const busy = site({ now: () => 0 })
    for (let i = 0; i < 5; i++) await busy.request(save(PLAN))
    const limited = await busy.request(save(PLAN))
    expect([limited.status, await limited.json()]).toEqual([429, { error: 'busy' }])
    const none = await site({ plans: null }).request(open('abcdefgh'))
    expect([none.status, await none.json()]).toEqual([503, { error: 'not-configured' }])
  })
})

describe('the status address, as API.md describes it', () => {
  it('reports the version and the data version in the described shape', async () => {
    const app = createPlansApp({ dataDir, allowedOrigins: [], plans: memoryPlans(), version: 'abc1234', dataVersion: '0123456789abcdef', revision: 'clps-plans-00001-abc' })
    const status = operation('status')
    const response = await app.request(`${ORIGIN}${status.path}`)
    expect(response.status).toBe(200)
    expect(differences(await response.json(), status.replies['200'].body)).toEqual([])
  })

  it('answers the web server, and refuses everyone else, in the described shapes', async () => {
    const forWeb = operation('status-for-web')
    const statusCheck = async (authorization: string | null) => (authorization === 'Bearer web' ? { ok: true as const } : { ok: false as const, why: authorization === 'Bearer other' ? ('not-web' as const) : ('missing' as const) })
    const app = (check: typeof statusCheck | null) => createPlansApp({ dataDir, allowedOrigins: [], plans: memoryPlans(), version: 'abc1234', dataVersion: '0123456789abcdef', revision: 'clps-plans-00001-abc', statusCheck: check })
    const ask = (check: typeof statusCheck | null, authorization?: string) => app(check).request(`${ORIGIN}${forWeb.path}`, { headers: authorization ? { authorization } : {} })
    const cases: [string, Response][] = [
      ['200', await ask(statusCheck, 'Bearer web')],
      ['401', await ask(statusCheck)],
      ['403', await ask(statusCheck, 'Bearer other')],
      ['503', await ask(null)],
    ]
    expect(cases.map(([reply]) => reply).toSorted()).toEqual(Object.keys(forWeb.replies).toSorted())
    for (const [reply, response] of cases) {
      expect(response.status).toBe(Number(reply))
      expect(differences(await response.json(), forWeb.replies[reply].body)).toEqual([])
    }
  })
})

describe('the description itself', () => {
  it('describes each operation once, with the methods and paths the service routes', () => {
    expect(described.map((item) => `${item.method} ${item.path}`)).toEqual(['POST /api/plans', 'GET /api/plans/<id>', 'GET /api/plans', 'GET /api/plans/library', 'DELETE /api/plans/<id>', 'PUT /api/plans/<id>', 'GET /api/plans/status', 'GET /api/plans/status/web'])
    expect(new Set(described.map((item) => item.operation)).size).toBe(described.length)
  })

  it('checks shapes the way it claims to: a missing, mistyped or extra field is each caught', () => {
    const shape = { id: 'id', 'note?': 'string', list: [{ at: 'time' }] }
    expect(differences({ id: 'abcd2345', list: [{ at: '2026-11-12T00:00:00.000Z' }] }, shape)).toEqual([])
    expect(differences({ list: [] }, shape)).toEqual(['body.id is missing'])
    expect(differences({ id: 'ABCD2345', list: [] }, shape)).toHaveLength(1)
    expect(differences({ id: 'abcd2345', list: [{ at: 'yesterday' }] }, shape)).toHaveLength(1)
    expect(differences({ id: 'abcd2345', list: [], owner: 'x' }, shape)).toEqual(['body.owner is sent but not described in API.md'])
    expect(differences({ error: 'busy' }, { error: '=origin' })).toHaveLength(1)
  })
})
