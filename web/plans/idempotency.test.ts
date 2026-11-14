import { describe, expect, it } from 'vitest'
import { fingerprintOf, KEY_HOURS, keyOf } from './idempotency'
import { type KeptKey, memoryPlans, type PlanStore } from './store'
import { as, identity, idOf, ORIGIN, PROGRAMS, save, VIEW } from './testing'

const KEY = '8e03978e-40d5-43e8-bc93-6894a57f9324'
const PLAN = { title: 'Two weeks on the ridge', note: '', view: VIEW }
const T0 = Date.parse('2026-11-12T00:00:00Z')

/** A store that counts the plans it really saved, and can be told to hold things up. */
function counting(base: PlanStore = memoryPlans()) {
  const saved: string[] = []
  const store: PlanStore = {
    ...base,
    async create(plan, key) {
      const done = await base.create(plan, key)
      if (done) saved.push(plan.id)
      return done
    },
  }
  return { store, saved }
}

describe.each(PROGRAMS)('idempotency keys on save, answered by $name', ({ site }) => {
  it('saves once for a first request, and gives the first answer again to a retry with the same key', async () => {
    const { store, saved } = counting()
    const app = site({ plans: store, now: () => T0 })

    const first = await app.request(save(PLAN, { key: KEY }))
    expect(first.status).toBe(201)
    expect(first.headers.get('idempotent-replayed')).toBeNull()
    const id = await idOf(first)

    // The retry: the same key and the same plan. The same status and the same body come back.
    for (let retry = 0; retry < 3; retry++) {
      const again = await app.request(save(PLAN, { key: KEY }))
      expect(again.status).toBe(201)
      expect(again.headers.get('idempotent-replayed')).toBe('true')
      expect(await again.json()).toEqual({ id })
    }
    expect(saved).toEqual([id])
    expect((await app.request(`${ORIGIN}/api/plans/${id}`)).status).toBe(200)
  })

  it('treats a retry that differs only in spacing as the same save, and the key in quotes as the same key', async () => {
    const { store, saved } = counting()
    const app = site({ plans: store, now: () => T0 })
    const id = await idOf(await app.request(save(PLAN, { key: KEY })))
    // The IETF draft writes the header's value as a quoted string; a bare value is the same key.
    const quoted = await app.request(save({ ...PLAN, title: '  Two weeks   on the ridge ' }, { key: `"${KEY}"` }))
    expect(quoted.status).toBe(201)
    expect(await quoted.json()).toEqual({ id })
    expect(saved).toHaveLength(1)
  })

  it('refuses the same key with a different plan, and saves nothing', async () => {
    const { store, saved } = counting()
    const app = site({ plans: store, identity, now: () => T0 })
    const id = await idOf(await app.request(save(PLAN, { key: KEY })))

    for (const different of [{ ...PLAN, title: 'Another plan' }, { ...PLAN, note: 'With a note now.' }, { ...PLAN, view: '#a=connecting-ridge@2027-07&t=3&limits=14_72_72_1_1&mode=plan' }]) {
      const refused = await app.request(save(different, { key: KEY, visitor: '203.0.113.8' }))
      expect(refused.status).toBe(422)
      expect(await refused.json()).toEqual({ error: 'key-reused' })
    }
    // The same plan for someone else is a different save too: a plan has one owner.
    expect((await app.request(as('token-of-ana', save(PLAN, { key: KEY, visitor: '203.0.113.9' })))).status).toBe(422)
    expect(saved).toEqual([id])
    // The refusals did not disturb the record: the first answer is still given.
    expect(await (await app.request(save(PLAN, { key: KEY, visitor: '203.0.113.10' }))).json()).toEqual({ id })
  })

  it('saves once when the same request arrives twice at the same moment', async () => {
    // Hold every request at the point of saving until all of them have got there, each with a plan
    // of its own to save and none having seen another's. That is the race: only the atomic write
    // can settle it.
    for (const together of [2, 5]) {
      const { store, saved } = counting()
      let ready = 0
      let release: () => void = () => {}
      const allReady = new Promise<void>((resolve) => (release = resolve))
      const raced: PlanStore = {
        ...store,
        async create(plan, key) {
          if (++ready === together) release()
          await allReady
          return store.create(plan, key)
        },
      }
      const app = site({ plans: raced, now: () => T0 })
      const answers = await Promise.all(Array.from({ length: together }, (_, n) => app.request(save(PLAN, { key: KEY, visitor: `203.0.113.${20 + n}` }))))

      expect(answers.map((answer) => answer.status)).toEqual(Array(together).fill(201))
      const ids = await Promise.all(answers.map(idOf))
      expect(new Set(ids).size).toBe(1)
      expect(saved).toEqual([ids[0]])
      // Exactly one of them did the saving; the others were given its answer.
      expect(answers.filter((answer) => answer.headers.get('idempotent-replayed') === 'true')).toHaveLength(together - 1)
    }
  })

  it('forgets a key after a day, whether or not the database has removed its record yet', async () => {
    let clock = T0
    const { store, saved } = counting()
    const app = site({ plans: store, now: () => clock })
    const first = await idOf(await app.request(save(PLAN, { key: KEY })))

    // One second short of a day: still the first answer.
    clock = T0 + KEY_HOURS * 3_600_000 - 1000
    expect(await (await app.request(save(PLAN, { key: KEY }))).json()).toEqual({ id: first })

    // A day on, the memory store still holds the old record, as Firestore does until its
    // time-to-live sweep gets to it. The key is free anyway: a different plan is saved under it.
    clock = T0 + KEY_HOURS * 3_600_000 + 1000
    expect((await store.savedBy(keyOfValue(KEY)))?.plan).toBe(first)
    const second = await app.request(save({ ...PLAN, title: 'A day later' }, { key: KEY }))
    expect(second.status).toBe(201)
    expect(second.headers.get('idempotent-replayed')).toBeNull()
    const secondId = await idOf(second)
    expect(secondId).not.toBe(first)
    expect(saved).toEqual([first, secondId])

    // And the key now means the second plan, for another day.
    expect(await (await app.request(save({ ...PLAN, title: 'A day later' }, { key: KEY }))).json()).toEqual({ id: secondId })
    expect((await app.request(save(PLAN, { key: KEY }))).status).toBe(422)
    // Both plans are still there: forgetting a key never touches a plan.
    for (const id of [first, secondId]) expect((await app.request(`${ORIGIN}/api/plans/${id}`)).status).toBe(200)
  })

  it('saves once when two requests reuse an expired key at the same moment', async () => {
    let clock = T0
    const { store, saved } = counting()
    const app = site({ plans: store, now: () => clock })
    await app.request(save(PLAN, { key: KEY }))
    clock = T0 + KEY_HOURS * 3_600_000 + 1000
    // Both find the expired record and both try to replace exactly that record. One does.
    const answers = await Promise.all([1, 2].map((n) => app.request(save({ ...PLAN, title: 'Tomorrow' }, { key: KEY, visitor: `203.0.113.${30 + n}` }))))
    expect(answers.map((answer) => answer.status)).toEqual([201, 201])
    const ids = await Promise.all(answers.map(idOf))
    expect(ids[0]).toBe(ids[1])
    expect(saved).toHaveLength(2)
  })

  it('picks another id when a plan id is taken, key or no key, and still records the key once', async () => {
    const base = memoryPlans()
    let refusals = 2
    // The first two tries find the id "taken": nothing is written, and the key has no record.
    const { store, saved } = counting({ ...base, create: (plan, key) => (refusals-- > 0 ? Promise.resolve(false) : base.create(plan, key)) })
    const app = site({ plans: store, now: () => T0 })
    const id = await idOf(await app.request(save(PLAN, { key: KEY })))
    expect(saved).toEqual([id])
    expect(await (await app.request(save(PLAN, { key: KEY }))).json()).toEqual({ id })
  })

  it('does not spend a key on a request that saved nothing', async () => {
    const { store, saved } = counting()
    const app = site({ plans: store, identity, now: () => T0 })
    // Refused for its content, for its sign-in and for its origin: none of these is remembered.
    expect((await app.request(save({ ...PLAN, title: '' }, { key: KEY }))).status).toBe(400)
    expect((await app.request(as('expired-or-forged', save(PLAN, { key: KEY })))).status).toBe(401)
    expect((await app.request(save(PLAN, { key: KEY, origin: 'https://evil.example' }))).status).toBe(403)
    expect(saved).toEqual([])
    expect((await app.request(save(PLAN, { key: KEY }))).status).toBe(201)
    expect(saved).toHaveLength(1)
  })

  it('refuses a key that is not one, and works as before when no key is sent', async () => {
    const { store, saved } = counting()
    const app = site({ plans: store, now: () => T0 })
    const bad = ['short', 'has spaces in the key!!', 'x'.repeat(65), '""', 'not~a~key~at~all~~', 'a/b/c/d/e/f/g/h/i/j']
    for (const [n, key] of bad.entries()) {
      const refused = await app.request(save(PLAN, { key, visitor: `198.51.100.${n}` }))
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ error: 'bad-key' })
    }
    expect(saved).toEqual([])
    // No key: every request is a new plan, exactly as before keys existed.
    const one = await idOf(await app.request(save(PLAN, { visitor: '198.51.100.90' })))
    const two = await idOf(await app.request(save(PLAN, { visitor: '198.51.100.90' })))
    expect(one).not.toBe(two)
    expect(saved).toEqual([one, two])
  })
})

/** The name a key's record is kept under, as the handler works it out. */
function keyOfValue(value: string): string {
  const key = keyOf(new Request(ORIGIN, { headers: { 'idempotency-key': value } }))
  if (key.kind !== 'key') throw new Error('not a key')
  return key.id
}

describe('reading a key and fingerprinting a save', () => {
  const header = (value?: string) => new Request(ORIGIN, value === undefined ? {} : { headers: { 'idempotency-key': value } })

  it('tells no key from a bad key from a key, and never uses the key itself as a name', () => {
    expect(keyOf(header())).toEqual({ kind: 'none' })
    expect(keyOf(header('too-short'))).toEqual({ kind: 'bad' })
    expect(keyOf(header('a/b/c/d/e/f/g/h/i/j'))).toEqual({ kind: 'bad' })
    const key = keyOf(header(KEY))
    expect(key).toEqual({ kind: 'key', id: expect.stringMatching(/^[0-9a-f]{40}$/) })
    expect(JSON.stringify(key)).not.toContain(KEY)
    expect(keyOf(header(`"${KEY}"`))).toEqual(key)
    expect(keyOf(header(`  ${KEY}  `))).toEqual(key)
    expect(keyOf(header(KEY.replace('8', '9')))).not.toEqual(key)
  })

  it('gives the same fingerprint to the same save and a different one to any other', () => {
    const one = fingerprintOf({ title: 'A', note: 'b', view: VIEW })
    expect(one).toMatch(/^[0-9a-f]{32}$/)
    expect(fingerprintOf({ title: 'A', note: 'b', view: VIEW })).toBe(one)
    expect(fingerprintOf({ title: 'A', note: 'b', view: VIEW, owner: 'owner-ana' })).not.toBe(one)
    // The fields are kept apart: moving a letter from one to the next is a different save.
    expect(fingerprintOf({ title: 'Ab', note: '', view: VIEW })).not.toBe(fingerprintOf({ title: 'A', note: 'b', view: VIEW }))
  })
})

describe('the memory store, as the stand-in for the database\'s atomic write', () => {
  const plan = (id: string) => ({ id, title: 't', note: '', view: VIEW, brief: [], created: '2026-11-12T00:00:00.000Z', expires: '2027-05-11T00:00:00.000Z' })
  const record = (id: string, planId: string) => ({ id, plan: planId, fingerprint: 'f', expires: '2026-11-13T00:00:00.000Z' })

  it('writes the plan and the key together, or neither', async () => {
    const store = memoryPlans()
    expect(await store.create(plan('aaaaaaaa'), record('k1', 'aaaaaaaa'))).toBe(true)
    // The key is taken: the second plan is not saved either.
    expect(await store.create(plan('bbbbbbbb'), record('k1', 'bbbbbbbb'))).toBe(false)
    expect(await store.get('bbbbbbbb')).toBeNull()
    // The id is taken: the second key is not recorded either.
    expect(await store.create(plan('aaaaaaaa'), record('k2', 'aaaaaaaa'))).toBe(false)
    expect(await store.savedBy('k2')).toBeNull()
  })

  it('replaces a record only when told exactly which one', async () => {
    const store = memoryPlans()
    await store.create(plan('aaaaaaaa'), record('k1', 'aaaaaaaa'))
    const kept = (await store.savedBy('k1')) as KeptKey
    expect(await store.create(plan('bbbbbbbb'), { ...record('k1', 'bbbbbbbb'), replaces: 'not-that-one' })).toBe(false)
    expect(await store.create(plan('bbbbbbbb'), { ...record('k1', 'bbbbbbbb'), replaces: kept.version })).toBe(true)
    // The same replacement a second time finds a newer record, and is refused.
    expect(await store.create(plan('cccccccc'), { ...record('k1', 'cccccccc'), replaces: kept.version })).toBe(false)
    expect((await store.savedBy('k1'))?.plan).toBe('bbbbbbbb')
    // Replacing a record that is not there is refused too.
    expect(await store.create(plan('dddddddd'), { ...record('k9', 'dddddddd'), replaces: kept.version })).toBe(false)
  })
})
