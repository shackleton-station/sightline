import { readAddress } from '../../src/lib/follow'
import { within } from '../../shared/redisStore'
import { COUNT_FRESH_MS, type News, type Room, type RoomStore, totalFollowers } from './store'

/** The Redis commands rooms use. Tests pass a fake; `redisClient.ts` passes the real ones. */
export interface RoomRedis {
  get(key: string): Promise<string | null>
  /** SET with an expiry, only if the key is new ('new', NX) or only if it exists ('existing', XX). True if it was written. */
  set(key: string, value: string, ttlMs: number, only: 'new' | 'existing'): Promise<boolean>
  del(key: string): Promise<void>
  hSet(key: string, field: string, value: string): Promise<void>
  hGetAll(key: string): Promise<Record<string, string>>
  hDel(key: string, fields: string[]): Promise<void>
  /** PEXPIRE: the key is deleted after `ttlMs`. */
  expire(key: string, ttlMs: number): Promise<void>
  publish(channel: string, message: string): Promise<void>
  /** Hears every message on a channel. A subscriber can run no other command, so it has a connection of its own. */
  subscribe(channel: string, heard: (message: string) => void): void
}

const PREFIX = 'clps:room:'
/** Every open room and when it ends, to cap how many there are. One small hash: there are at most a few dozen. */
const OPEN = 'clps:rooms'
const NEWS = 'clps:rooms:news'
/** The list of open rooms and a room's follower counts are rewritten while in use, and deleted by Redis after this long unused. */
const OPEN_TTL_MS = 24 * 60 * 60_000
const COUNTS_TTL_MS = 2 * COUNT_FRESH_MS

/** News as it arrives from another copy, or null if it isn't shaped as this code sends it. */
function readNews(message: string): { id: string; news: News } | null {
  try {
    const { id, news } = JSON.parse(message) as { id?: unknown; news?: { kind?: unknown; at?: unknown; by?: unknown } }
    if (typeof id !== 'string' || !news) return null
    if (news.kind === 'ended') return { id, news: { kind: 'ended' } }
    if (news.kind === 'counted' && typeof news.by === 'string') return { id, news: { kind: 'counted', by: news.by } }
    const at = news.kind === 'moved' ? readAddress(news.at) : null
    return at ? { id, news: { kind: 'moved', at } } : null
  } catch {
    return null
  }
}

/**
 * Rooms on Redis, shared by every copy of the server. A room is one value that expires on its own;
 * a change is published on one channel that every copy listens to. A message is sent once and not
 * kept, so a copy that misses one catches up when it next reads the room (rooms/hub.ts does, every
 * few seconds). If Redis is slow or down, each call fails and the caller says so: a room that lived
 * in one copy's memory would reach only the followers who happen to be connected to that copy.
 */
export function redisRooms(redis: RoomRedis, now: () => number = Date.now): RoomStore {
  const tell = (id: string, news: News) => within(redis.publish(NEWS, JSON.stringify({ id, news })))

  return {
    kind: 'redis',
    async create(id, room, ttlMs, maxRooms) {
      const open = await within(redis.hGetAll(OPEN))
      const over = Object.keys(open).filter((other) => Number(open[other]) <= now())
      if (over.length > 0) await within(redis.hDel(OPEN, over))
      // Two copies checking at the same instant can both let a room in: the cap can be passed by one or two.
      if (Object.keys(open).length - over.length >= maxRooms) return 'full'
      if (!(await within(redis.set(PREFIX + id, JSON.stringify(room), ttlMs, 'new')))) return 'taken'
      await within(redis.hSet(OPEN, id, String(now() + ttlMs)))
      await within(redis.expire(OPEN, OPEN_TTL_MS))
      return 'created'
    },
    async get(id) {
      const kept = await within(redis.get(PREFIX + id))
      return kept ? (JSON.parse(kept) as Room) : null
    },
    async move(id, room, ttlMs) {
      // Only if it exists: a room that has just expired is not brought back by a late move.
      if (!(await within(redis.set(PREFIX + id, JSON.stringify(room), ttlMs, 'existing')))) return false
      await within(redis.hSet(OPEN, id, String(now() + ttlMs)))
      await tell(id, { kind: 'moved', at: room.at })
      return true
    },
    async end(id) {
      await within(redis.del(PREFIX + id))
      await within(redis.hDel(OPEN, [id]))
      await tell(id, { kind: 'ended' })
    },
    async count(id, copy, followers) {
      const key = `${PREFIX}${id}:followers`
      if (followers > 0) {
        await within(redis.hSet(key, copy, `${followers}@${now()}`))
        await within(redis.expire(key, COUNTS_TTL_MS))
      } else {
        await within(redis.hDel(key, [copy]))
      }
      const reports = Object.values(await within(redis.hGetAll(key))).map((report) => {
        const [count, at] = report.split('@').map(Number)
        return { followers: count, at }
      })
      return totalFollowers(reports, now())
    },
    recount: (id, copy) => tell(id, { kind: 'counted', by: copy }),
    listen(heard) {
      redis.subscribe(NEWS, (message) => {
        const read = readNews(message)
        if (read) heard(read.id, read.news)
      })
    },
  }
}
