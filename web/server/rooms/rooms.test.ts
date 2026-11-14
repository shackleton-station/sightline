import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import type { Deps } from '../deps'
import { ROOM_RULES } from './handler'
import { type RoomRedis, redisRooms } from './redisRooms'
import { COUNT_FRESH_MS, memoryRooms } from './store'

const ORIGIN = 'https://clps-web.example.run.app'
const SCOUT = { path: '/scout/', query: '', hash: '#a=connecting-ridge@2027-05&t=120&limits=14_72_72_1_1&view=3d&mode=learn' }
const at = (hour: number) => ({ ...SCOUT, hash: SCOUT.hash.replace('t=120', `t=${hour}`) })

const site = (overrides: Partial<Deps> = {}) => createApp({ distDir: '/nonexistent', bucket: null, allowedOrigins: [], ...overrides })
type App = ReturnType<typeof site>
const post = (path: string, body: unknown, init: { origin?: string; visitor?: string; key?: string; method?: string } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', origin: init.origin ?? ORIGIN, 'x-forwarded-for': init.visitor ?? '203.0.113.7', ...(init.key ? { 'x-presenter-key': init.key } : {}) },
    body: init.method === 'DELETE' ? undefined : JSON.stringify(body),
  })

/** Starts a room on Scout and returns what the presenter's browser keeps. */
async function present(app: App, visitor = '203.0.113.7'): Promise<{ id: string; key: string }> {
  const started = await app.request(post('/api/rooms', { at: SCOUT }, { visitor }))
  expect(started.status).toBe(201)
  return (await started.json()) as { id: string; key: string }
}
const publish = (app: App, room: { id: string; key: string }, to: unknown) => app.request(post(`/api/rooms/${room.id}`, { at: to }, { key: room.key }))

interface Heard {
  event: string
  data: unknown
}
function eventsIn(text: string): Heard[] {
  return text.split('\n\n').flatMap((block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1]
    return event ? [{ event, data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as unknown }] : []
  })
}

/** A follower's browser: opens the room's stream and keeps every event it carries, as they arrive. */
async function follow(app: App, id: string, options = '') {
  const response = await app.request(`${ORIGIN}/api/rooms/${id}/events${options}`, { headers: { 'x-forwarded-for': '198.51.100.1' } })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const heard: Heard[] = []
  const state = { over: false }
  const decoder = new TextDecoder()
  void (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
      if (chunk.done) break
      heard.push(...eventsIn(decoder.decode(chunk.value)))
    }
    state.over = true
  })()
  return {
    heard,
    /** The addresses it was sent, as hours of the month. */
    hours: () => heard.filter((item) => item.event === 'at').map((item) => Number(/t=(\d+)/.exec((item.data as { hash: string }).hash)?.[1])),
    count: () => (heard.findLast((item) => item.event === 'count')?.data as { followers: number } | undefined)?.followers,
    last: () => heard.at(-1)?.event,
    over: () => state.over,
    leave: () => reader.cancel(),
  }
}

/** Lets timers that are due, and everything waiting on them, run. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
/** Long enough for a burst of joins and leaves to be counted. */
const COUNTED_MS = 200

/** A stand-in for Redis: the values, hashes, expiries and one channel that rooms use, and a switch to take it down. */
function fakeRedis(): RoomRedis & { down: boolean } {
  const values = new Map<string, { value: string; expires: number }>()
  const hashes = new Map<string, Map<string, string>>()
  const listeners: ((message: string) => void)[] = []
  const up = <T>(work: () => T): Promise<T> => (fake.down ? Promise.reject(new Error('connection refused')) : Promise.resolve(work()))
  const live = (key: string) => {
    const found = values.get(key)
    if (found && found.expires <= Date.now()) values.delete(key)
    return values.get(key)
  }
  const fake = {
    down: false,
    get: (key: string) => up(() => live(key)?.value ?? null),
    set: (key: string, value: string, ttlMs: number, only: 'new' | 'existing') =>
      up(() => {
        if ((only === 'new') === Boolean(live(key))) return false
        values.set(key, { value, expires: Date.now() + ttlMs })
        return true
      }),
    del: (key: string) => up(() => void values.delete(key)),
    hSet: (key: string, field: string, value: string) => up(() => void hashes.set(key, new Map(hashes.get(key)).set(field, value))),
    hGetAll: (key: string) => up(() => Object.fromEntries(hashes.get(key) ?? [])),
    hDel: (key: string, fields: string[]) => up(() => fields.forEach((field) => hashes.get(key)?.delete(field))),
    expire: () => up(() => {}),
    // As Redis does: delivered to whoever is listening now, a moment later, and not kept for anyone else.
    publish: (_channel: string, message: string) => up(() => listeners.forEach((heard) => queueMicrotask(() => heard(message)))),
    subscribe: (_channel: string, heard: (message: string) => void) => void listeners.push(heard),
  }
  return fake
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('follow the presenter', () => {
  it('starts a room with a short id and a key, and only that key may move or end it', async () => {
    const app = site()
    const room = await present(app)
    expect(room.id).toMatch(/^[a-hj-km-np-z2-9]{6}$/)
    expect(room.key.length).toBeGreaterThanOrEqual(32)

    expect((await publish(app, room, at(121))).status).toBe(200)
    expect((await publish(app, { ...room, key: 'not-the-key' }, at(122))).status).toBe(403)
    expect((await app.request(post(`/api/rooms/${room.id}`, { at: at(122) }))).status).toBe(403)
    expect((await app.request(post(`/api/rooms/${room.id}`, {}, { key: 'not-the-key', method: 'DELETE' }))).status).toBe(403)
    // The wrong key moved nothing: someone joining now is where the presenter last was.
    const follower = await follow(app, room.id)
    await tick()
    expect(follower.hours()).toEqual([121])

    expect((await publish(app, { id: 'abcdef', key: room.key }, at(1))).status).toBe(404)
    expect((await app.request(post(`/api/rooms/${room.id}`, { at: at(1) }, { key: room.key, origin: 'https://evil.example' }))).status).toBe(403)
    expect((await app.request(post('/api/rooms', { at: SCOUT }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await app.request(`${ORIGIN}/api/rooms/${room.id}`)).status).toBe(405)
    expect((await app.request(`${ORIGIN}/api/rooms/${room.id}/events`, { method: 'POST' })).status).toBe(405)
    for (const id of ['ABCDEF', 'short', 'abcdefgh', 'abcde1']) expect((await app.request(`${ORIGIN}/api/rooms/${id}/events`)).status).toBe(404)
  })

  it('gives a follower who joins late the current address at once, then each change', async () => {
    const app = site()
    const room = await present(app)
    await publish(app, room, at(200))
    await publish(app, room, { path: '/atlas/', query: '', hash: at(201).hash })

    const follower = await follow(app, room.id)
    await tick()
    expect(follower.heard).toEqual([{ event: 'at', data: { path: '/atlas/', query: '', hash: at(201).hash } }])

    await publish(app, room, { path: '/', query: '?ui=next', hash: at(202).hash })
    await publish(app, room, { path: '/', query: '', hash: '' })
    await tick()
    expect(follower.heard.slice(1, 3)).toEqual([
      { event: 'at', data: { path: '/', query: '?ui=next', hash: at(202).hash } },
      { event: 'at', data: { path: '/', query: '', hash: '' } },
    ])
    // The same address again (the presenter's page says it is still there) is not sent twice.
    await publish(app, room, { path: '/', query: '', hash: '' })
    await tick()
    expect(follower.heard.filter((item) => item.event === 'at')).toHaveLength(3)
  })

  it('publishes only addresses on this site: one of its pages, a bounded query and hash, never a URL', async () => {
    const app = site()
    const room = await present(app)
    const follower = await follow(app, room.id)
    const refused = [
      { path: 'https://evil.example/', query: '', hash: '' },
      { path: '//evil.example/scout/', query: '', hash: '' },
      { path: '/\\evil.example', query: '', hash: '' },
      { path: '/scout/../../evil', query: '', hash: '' },
      { path: '/scout', query: '', hash: '' },
      { path: '/api/status', query: '', hash: '' },
      { path: '/gpu/', query: '', hash: '' },
      { path: '/', query: 'ui=next', hash: '' },
      { path: '/', query: '?next=https://evil.example/<script>', hash: '' },
      { path: '/', query: `?x=${'y'.repeat(200)}`, hash: '' },
      { path: '/', query: '?follow=abcdef', hash: '' },
      { path: '/', query: '', hash: 'a=connecting-ridge@2027-05' },
      { path: '/', query: '', hash: '#a=x y' },
      { path: '/', query: '', hash: '#"><script>alert(1)</script>' },
      { path: '/', query: '', hash: '#javascript:alert`1`' },
      { path: '/', query: '', hash: `#${'a'.repeat(1500)}` },
      { path: '/', query: '' },
      { path: '/', query: '', hash: 7 },
      'https://evil.example/',
      null,
    ]
    for (const address of refused) expect((await publish(app, room, address)).status, JSON.stringify(address)).toBe(400)
    expect((await app.request(post('/api/rooms', { at: { path: 'https://evil.example/', query: '', hash: '' } }, { visitor: '203.0.113.8' }))).status).toBe(400)
    expect((await app.request(post('/api/rooms', 'https://evil.example/', { visitor: '203.0.113.8' }))).status).toBe(400)
    // A URL inside the hash is only text after "#": the follower stays on this site.
    expect((await publish(app, room, { path: '/', query: '', hash: '#https://evil.example/' })).status).toBe(200)
    // Anything else in the body is dropped, not passed on.
    expect((await app.request(post(`/api/rooms/${room.id}`, { at: { ...at(5), url: 'https://evil.example/' }, note: 'hello' }, { key: room.key }))).status).toBe(200)
    await tick()
    expect(follower.heard.filter((item) => item.event === 'at')).toEqual([
      { event: 'at', data: SCOUT },
      { event: 'at', data: { path: '/', query: '', hash: '#https://evil.example/' } },
      { event: 'at', data: at(5) },
    ])
  })

  it('sends a follower who has fallen behind the newest address, not a queue of old ones', async () => {
    const app = site()
    const room = await present(app)
    const quick = await follow(app, room.id)
    // A phone on a bad connection: it has opened the stream and is not reading it.
    const response = await app.request(`${ORIGIN}/api/rooms/${room.id}/events`)
    const slow = (response.body as ReadableStream<Uint8Array>).getReader()
    for (let hour = 1; hour <= 50; hour += 1) await publish(app, room, at(hour))
    await tick()
    expect(quick.hours()).toEqual([120, ...Array.from({ length: 50 }, (_, index) => index + 1)])

    let text = ''
    const decoder = new TextDecoder()
    for (let reads = 0; reads < 4 && !text.includes('t=50&'); reads += 1) text += decoder.decode((await slow.read()).value)
    const hours = eventsIn(text)
      .filter((item) => item.event === 'at')
      .map((item) => (item.data as { hash: string }).hash)
    expect(hours).toEqual([at(50).hash])
  })

  it('counts followers, not the presenter, and the count goes down when one leaves', async () => {
    const app = site()
    const room = await present(app)
    const presenter = await follow(app, room.id, '?watch')
    const first = await follow(app, room.id)
    const second = await follow(app, room.id)
    await tick(COUNTED_MS)
    expect([presenter.count(), first.count(), second.count()]).toEqual([2, 2, 2])
    expect(((await (await app.request(`${ORIGIN}/api/status`)).json()) as { follow: unknown }).follow).toEqual({ rooms: 'memory', streams: 3 })

    await second.leave()
    await tick(COUNTED_MS)
    expect([presenter.count(), first.count()]).toEqual([1, 1])
    await first.leave()
    await tick(COUNTED_MS)
    expect(presenter.count()).toBe(0)
  })

  it(`lets ${ROOM_RULES.maxFollowers} follow a room and tells the next it is full`, async () => {
    const app = site({ store: undefined })
    const room = await present(app)
    const presenter = await follow(app, room.id, '?watch')
    const followers = []
    for (let i = 0; i < ROOM_RULES.maxFollowers - 1; i += 1) followers.push(await follow(app, room.id))
    await tick(COUNTED_MS)
    expect(presenter.count()).toBe(ROOM_RULES.maxFollowers - 1)
    // This copy holds as many streams as it may: the next browser is asked to try again, and may reach another copy.
    const busy = await app.request(`${ORIGIN}/api/rooms/${room.id}/events`)
    expect(busy.status).toBe(503)

    await presenter.leave()
    followers.push(await follow(app, room.id))
    await tick(COUNTED_MS)
    await followers[0].leave()
    await tick(COUNTED_MS)
    const late = await follow(app, room.id)
    await tick(COUNTED_MS)
    expect(late.hours()).toEqual([120])
    const extra = await app.request(`${ORIGIN}/api/rooms/${room.id}/events?watch`)
    expect(extra.status).toBe(503)
  })

  it('tells one follower too many, on another copy, that the room is full', async () => {
    const redis = fakeRedis()
    const [one, two] = [site({ rooms: redisRooms(redis) }), site({ rooms: redisRooms(redis) })]
    const room = await present(one)
    for (let i = 0; i < ROOM_RULES.maxFollowers; i += 1) await follow(one, room.id)
    await tick(COUNTED_MS)
    const extra = await follow(two, room.id)
    await tick()
    expect(extra.heard).toEqual([{ event: 'full', data: {} }])
    expect(extra.over()).toBe(true)
  })

  it('ends a stream cleanly before the platform would cut it, and a room when its presenter stops or goes quiet', async () => {
    const app = site()
    const room = await present(app)
    const follower = await follow(app, room.id)
    await tick(ROOM_RULES.streamMs - 1)
    expect(follower.over()).toBe(false)
    await tick(1)
    expect(follower.over()).toBe(true)
    // Nothing said at the end: the browser's EventSource connects again by itself, and gets the address at once.
    expect(follower.last()).not.toBe('ended')
    const again = await follow(app, room.id)
    await tick()
    expect(again.hours()).toEqual([120])

    // The presenter stops: everyone is told, and the room is gone.
    expect((await app.request(post(`/api/rooms/${room.id}`, {}, { key: room.key, method: 'DELETE' }))).status).toBe(200)
    await tick()
    expect(again.last()).toBe('ended')
    expect(again.over()).toBe(true)
    expect((await publish(app, room, at(1))).status).toBe(404)
    const tooLate = await follow(app, room.id)
    await tick()
    expect(tooLate.heard).toEqual([{ event: 'ended', data: {} }])

    // The presenter goes quiet (a closed laptop): the room ends by itself, and followers hear within a few seconds.
    const quiet = await present(app)
    await tick(ROOM_RULES.idleMs - 30_000)
    expect((await publish(app, quiet, at(7))).status).toBe(200)
    await tick(ROOM_RULES.idleMs - 30_000)
    const waiting = await follow(app, quiet.id)
    await tick()
    expect(waiting.hours()).toEqual([7])
    await tick(30_000 + ROOM_RULES.refreshMs)
    expect(waiting.last()).toBe('ended')
    expect((await publish(app, quiet, at(8))).status).toBe(404)
  })

  it('ends a room three hours after it started, however busy', async () => {
    const app = site()
    const room = await present(app)
    for (let minutes = 9; minutes < 180; minutes += 9) {
      await tick(9 * 60_000)
      expect((await publish(app, room, at(minutes))).status, `${minutes} minutes in`).toBe(200)
    }
    await tick(9 * 60_000)
    expect((await publish(app, room, at(0))).status).toBe(404)
  })

  it('limits starting rooms per visitor and how many are open at once', async () => {
    const app = site()
    for (let i = 0; i < 10; i += 1) await present(app)
    expect((await app.request(post('/api/rooms', { at: SCOUT }))).status).toBe(429)
    await present(app, '203.0.113.8')
    await tick(10 * 60_000)
    await present(app)

    // 50 rooms open at once, for everyone together; one that ends makes room for another.
    const rooms = memoryRooms()
    const full = site({ rooms })
    const open = []
    for (let i = 0; i < ROOM_RULES.maxRooms; i += 1) open.push(await present(full, `198.51.100.${i}`))
    const refused = await full.request(post('/api/rooms', { at: SCOUT }, { visitor: '192.0.2.1' }))
    expect([refused.status, await refused.json()]).toEqual([429, { error: 'full' }])
    await full.request(post(`/api/rooms/${open[0].id}`, {}, { key: open[0].key, method: 'DELETE', visitor: '198.51.100.0' }))
    await present(full, '192.0.2.1')
  })

  it('limits publishing to 90 a minute per visitor', async () => {
    const app = site()
    const room = await present(app)
    for (let i = 0; i < 90; i += 1) expect((await publish(app, room, at(i))).status).toBe(200)
    expect((await publish(app, room, at(91))).status).toBe(429)
  })

  it('with tracing on, each request is a trace with its steps, and a stream still streams', async () => {
    const written: { name: string; steps: string[] }[] = []
    const app = site({ traces: { write: (_id, spans) => void written.push({ name: spans[0].name, steps: spans.slice(1).map((step) => step.name) }) } })
    const room = await present(app)
    const follower = await follow(app, room.id)
    await publish(app, room, at(121))
    await tick()
    expect(follower.hours()).toEqual([120, 121])
    // The stream's trace is written when the stream ends.
    await tick(ROOM_RULES.streamMs)
    expect(follower.over()).toBe(true)
    expect(written).toEqual([
      { name: 'POST /api/rooms', steps: ['rate limits', 'room store'] },
      { name: 'POST /api/rooms/<id>', steps: ['rate limits', 'room store', 'room store'] },
      { name: 'GET /api/rooms/<id>/events', steps: ['rate limits', 'join room'] },
    ])
  })

  it('answers 503 everywhere when switched off, and says so in the status', async () => {
    const app = site({ rooms: null })
    expect((await app.request(post('/api/rooms', { at: SCOUT }))).status).toBe(503)
    expect((await app.request(`${ORIGIN}/api/rooms/abcdef/events`)).status).toBe(503)
    expect(((await (await app.request(`${ORIGIN}/api/status`)).json()) as { follow: unknown }).follow).toBe(false)
  })
})

describe('two copies of the server sharing one Redis', () => {
  it('delivers a publish that reaches one copy to followers connected to the other', async () => {
    const redis = fakeRedis()
    const [one, two] = [site({ rooms: redisRooms(redis) }), site({ rooms: redisRooms(redis) })]
    const room = await present(one)
    const far = await follow(two, room.id)
    const near = await follow(one, room.id)
    await tick()
    expect([far.hours(), near.hours()]).toEqual([[120], [120]])

    // The presenter's publishes land on either copy; both followers get each one.
    await publish(one, room, at(121))
    await publish(two, room, at(122))
    await tick()
    expect([far.hours(), near.hours()]).toEqual([
      [120, 121, 122],
      [120, 121, 122],
    ])
    expect((await publish(two, { ...room, key: 'not-the-key' }, at(1))).status).toBe(403)

    // Ending it through one copy ends it for the follower on the other.
    await one.request(post(`/api/rooms/${room.id}`, {}, { key: room.key, method: 'DELETE' }))
    await tick()
    expect([far.last(), near.last()]).toEqual(['ended', 'ended'])
    expect(((await (await one.request(`${ORIGIN}/api/status`)).json()) as { follow: unknown }).follow).toEqual({ rooms: 'redis', streams: 0 })
  })

  it('adds up the followers on every copy, on every copy', async () => {
    const redis = fakeRedis()
    const [one, two] = [site({ rooms: redisRooms(redis) }), site({ rooms: redisRooms(redis) })]
    const room = await present(one)
    const presenter = await follow(one, room.id, '?watch')
    const onOne = await follow(one, room.id)
    const onTwo = [await follow(two, room.id), await follow(two, room.id)]
    await tick(COUNTED_MS)
    expect([presenter.count(), onOne.count(), onTwo[0].count()]).toEqual([3, 3, 3])
    await onTwo[1].leave()
    await tick(COUNTED_MS)
    expect([presenter.count(), onOne.count(), onTwo[0].count()]).toEqual([2, 2, 2])
    await onTwo[0].leave()
    await tick(COUNTED_MS)
    expect(presenter.count()).toBe(1)
  })

  it('repairs a missed message within seconds, by reading the room again', async () => {
    const redis = fakeRedis()
    const [one, two] = [site({ rooms: redisRooms(redis) }), site({ rooms: redisRooms(redis) })]
    const room = await present(one)
    const far = await follow(two, room.id)
    await tick()
    // The message is lost between Redis and the second copy (a dropped connection): the room itself still moved.
    const publishToNobody = vi.spyOn(redis, 'publish').mockResolvedValueOnce()
    await publish(one, room, at(300))
    await tick()
    expect(far.hours()).toEqual([120])
    await tick(ROOM_RULES.refreshMs)
    expect(far.hours()).toEqual([120, 300])
    publishToNobody.mockRestore()
  })

  it('answers 503 while Redis is down, keeps followers connected, and carries on when it is back', async () => {
    const redis = fakeRedis()
    const app = site({ rooms: redisRooms(redis) })
    const room = await present(app)
    const follower = await follow(app, room.id)
    await tick(COUNTED_MS)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    redis.down = true
    expect((await publish(app, room, at(1))).status).toBe(503)
    expect((await app.request(post('/api/rooms', { at: SCOUT }, { visitor: '203.0.113.9' }))).status).toBe(503)
    expect((await app.request(`${ORIGIN}/api/rooms/${room.id}/events`)).status).toBe(503)
    await tick(ROOM_RULES.refreshMs * 2)
    expect([follower.over(), follower.last()]).toEqual([false, 'count'])
    redis.down = false
    expect((await publish(app, room, at(2))).status).toBe(200)
    await tick()
    expect(follower.hours()).toEqual([120, 2])
    vi.restoreAllMocks()
  })
})

describe('the follower count across copies', () => {
  it.each([
    ['in memory', () => memoryRooms()],
    ['on Redis', () => redisRooms(fakeRedis())],
  ])('%s: stops counting a copy that has died, so the total cannot creep up', async (_name, make) => {
    const rooms = make()
    await rooms.create('abcdef', { keyHash: 'x', at: SCOUT, ends: Date.now() + 3_600_000 }, 600_000, 50)
    expect(await rooms.count('abcdef', 'copy-that-dies', 5)).toBe(5)
    expect(await rooms.count('abcdef', 'copy-that-lives', 2)).toBe(7)
    // A live copy reports again every few seconds; the dead one never does, and never says goodbye.
    vi.advanceTimersByTime(COUNT_FRESH_MS - 1)
    expect(await rooms.count('abcdef', 'copy-that-lives', 2)).toBe(7)
    vi.advanceTimersByTime(1)
    expect(await rooms.count('abcdef', 'copy-that-lives', 3)).toBe(3)
    expect(await rooms.count('abcdef', 'copy-that-lives', 0)).toBe(0)
  })

  it('on Redis: refuses an id in use, forgets a room when it expires, and never brings one back', async () => {
    const rooms = redisRooms(fakeRedis())
    const room = { keyHash: 'x', at: SCOUT, ends: Date.now() + 3_600_000 }
    expect(await rooms.create('abcdef', room, 1000, 2)).toBe('created')
    expect(await rooms.create('abcdef', room, 1000, 2)).toBe('taken')
    expect(await rooms.create('abcdeg', room, 5000, 2)).toBe('created')
    expect(await rooms.create('abcdeh', room, 1000, 2)).toBe('full')
    vi.advanceTimersByTime(1000)
    expect(await rooms.get('abcdef')).toBeNull()
    expect(await rooms.move('abcdef', room, 1000)).toBe(false)
    expect(await rooms.get('abcdef')).toBeNull()
    expect(await rooms.create('abcdeh', room, 1000, 2)).toBe('created')
  })
})
