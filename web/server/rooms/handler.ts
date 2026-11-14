import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type Address, ROOM_ID, readAddress } from '../../src/lib/follow'
import type { Deps } from '../deps'
import { originAllowed, reply, visitorOf } from '../../shared/http'
import { newId } from '../../shared/ids'
import type { Limiter } from '../../shared/store'
import { span } from '../../shared/trace'
import type { HubRules, RoomHub } from './hub'
import type { Room, RoomStore } from './store'

export interface RoomLimits {
  /** Starting a room: per visitor, and everyone together. */
  start: Limiter
  startAll: Limiter
  /** Moving or ending a room, per visitor. The page publishes once a second at most. */
  move: Limiter
  /** Opening a stream, per visitor. A follower opens one per page and one more each minute. */
  join: Limiter
}

/** Rooms are for a pitch, not for a week. */
export const ROOM_RULES = {
  /** A room ends this long after its presenter's last publish. The presenter's page publishes every few minutes while it is open. */
  idleMs: 10 * 60_000,
  /** And this long after it started, whatever happens. */
  lifeMs: 3 * 60 * 60_000,
  /** Rooms open at once, for everyone together. */
  maxRooms: 50,
  maxFollowers: 60,
  maxStreams: 60,
  streamMs: 55_000,
  refreshMs: 5_000,
} satisfies HubRules & Record<string, number>

const ID_LENGTH = 6
const MAX_BODY_CHARS = 4000
const KEY_HEADER = 'x-presenter-key'

const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex')

/** The address in a request's body, or null if it isn't one a presenter may publish. */
async function addressIn(request: Request): Promise<Address | null> {
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) return null
  try {
    return readAddress((JSON.parse(text) as { at?: unknown } | null)?.at)
  } catch {
    return null
  }
}

/** POST /api/rooms: starts a room where the presenter is, and returns its id and the key that moves it. */
async function startRoom(request: Request, deps: Deps, limits: RoomLimits, rooms: RoomStore): Promise<Response> {
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  const allowed = await span('rate limits', () => Promise.all([limits.start.take(visitorOf(request, deps.trustedProxies)), limits.startAll.take('all')]))
  if (allowed.includes(false)) return reply({ error: 'busy' }, 429)
  const at = await addressIn(request)
  if (!at) return reply({ error: 'bad-address' }, 400)

  const now = deps.now?.() ?? Date.now()
  // The key is made here and handed over once. Only its fingerprint is kept, so reading the store gives nobody a room.
  const key = randomBytes(24).toString('base64url')
  const room: Room = { keyHash: fingerprint(key), at, ends: now + ROOM_RULES.lifeMs }
  // Ids are random; if one is taken (it almost never is), pick another.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = newId(ID_LENGTH)
    const made = await span('room store', () => rooms.create(id, room, ROOM_RULES.idleMs, ROOM_RULES.maxRooms))
    if (made === 'full') return reply({ error: 'full' }, 429)
    if (made === 'created') return reply({ id, key }, 201)
  }
  return reply({ error: 'server' }, 500)
}

/** The room, if the request carries its presenter's key; otherwise the refusal to send. */
async function presenterOf(request: Request, deps: Deps, limits: RoomLimits, rooms: RoomStore, id: string): Promise<Room | Response> {
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  if (!(await span('rate limits', () => limits.move.take(visitorOf(request, deps.trustedProxies))))) return reply({ error: 'busy' }, 429)
  const room = await span('room store', () => rooms.get(id))
  if (!room) return reply({ error: 'not-found' }, 404)
  const given = Buffer.from(fingerprint(request.headers.get(KEY_HEADER) ?? ''))
  if (!timingSafeEqual(given, Buffer.from(room.keyHash))) return reply({ error: 'not-yours' }, 403)
  return room
}

/** POST /api/rooms/<id>: the presenter is somewhere new. Only the newest place is kept. */
async function moveRoom(request: Request, deps: Deps, limits: RoomLimits, rooms: RoomStore, id: string): Promise<Response> {
  const room = await presenterOf(request, deps, limits, rooms, id)
  if (room instanceof Response) return room
  const at = await addressIn(request)
  if (!at) return reply({ error: 'bad-address' }, 400)
  const left = room.ends - (deps.now?.() ?? Date.now())
  const moved = left > 0 && (await span('room store', () => rooms.move(id, { ...room, at }, Math.min(ROOM_RULES.idleMs, left))))
  return moved ? reply({ ok: true }) : reply({ error: 'not-found' }, 404)
}

/** DELETE /api/rooms/<id>: the presenter stops. */
async function endRoom(request: Request, deps: Deps, limits: RoomLimits, rooms: RoomStore, id: string): Promise<Response> {
  const room = await presenterOf(request, deps, limits, rooms, id)
  if (room instanceof Response) return room
  await span('room store', () => rooms.end(id))
  return reply({ ended: id })
}

/**
 * GET /api/rooms/<id>/events: the room as a stream of server-sent events. `at` is where the presenter
 * is (sent at once, then on each change), `count` is how many are following, `ended` and `full` say why
 * the stream is over. A browser's EventSource sends no Origin for its own site, so this is open to
 * anyone with the id, like opening a shared plan. `?watch` is the presenter's own stream: not counted.
 */
async function followRoom(request: Request, deps: Deps, limits: RoomLimits, hub: RoomHub, id: string): Promise<Response> {
  if (!(await span('rate limits', () => limits.join.take(visitorOf(request, deps.trustedProxies))))) return reply({ error: 'busy' }, 429)
  const stream = await span('join room', () => hub.open(id, !new URL(request.url).searchParams.has('watch')))
  return stream === 'busy' ? reply({ error: 'busy' }, 503) : stream
}

/** The rooms API. `rest` is the path after /api/rooms. Null rooms means following is switched off. */
export async function handleRooms(request: Request, deps: Deps, limits: RoomLimits, rooms: RoomStore | null, hub: RoomHub | null, rest: string): Promise<Response> {
  if (!rooms || !hub) return reply({ error: 'not-configured' }, 503)
  const { method } = request
  try {
    if (rest === '' || rest === '/') return method === 'POST' ? await startRoom(request, deps, limits, rooms) : reply({ error: 'method' }, 405)
    const [id, events, ...more] = rest.slice(1).split('/')
    // An id that couldn't be one of ours never reaches the store.
    if (!ROOM_ID.test(id) || more.length > 0 || (events !== undefined && events !== 'events')) return reply({ error: 'not-found' }, 404)
    if (events) return method === 'GET' ? await followRoom(request, deps, limits, hub, id) : reply({ error: 'method' }, 405)
    if (method === 'POST') return await moveRoom(request, deps, limits, rooms, id)
    if (method === 'DELETE') return await endRoom(request, deps, limits, rooms, id)
    return reply({ error: 'method' }, 405)
  } catch (error) {
    // The store (Redis) is down or slow. Nothing is half done: the presenter's page tries again, and followers stay where they are.
    console.error('rooms failed', error)
    return reply({ error: 'unavailable' }, 503)
  }
}
