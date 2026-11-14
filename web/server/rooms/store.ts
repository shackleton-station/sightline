import type { Address } from '../../src/lib/follow'

/** A presenter's room: where the presenter is now, and what proves who may move it. */
export interface Room {
  /** A one-way fingerprint of the presenter's key. The key itself is only in the presenter's browser. */
  keyHash: string
  at: Address
  /** When the room ends whatever happens (ms since 1970). */
  ends: number
}

/** What one copy of the server hears about a room from any copy. */
export type News = { kind: 'moved'; at: Address } | { kind: 'ended' } | { kind: 'counted'; by: string }

/**
 * Where rooms live, and how copies of the server tell one another about them. On Redis, every copy
 * shares the rooms and hears every change (publish/subscribe). In memory, one copy has them to itself:
 * fine for one copy and for tests.
 */
export interface RoomStore {
  kind: 'redis' | 'memory'
  /** Starts a room that ends after `ttlMs` with no move. 'taken': the id is in use. 'full': `maxRooms` are open. */
  create(id: string, room: Room, ttlMs: number, maxRooms: number): Promise<'created' | 'taken' | 'full'>
  get(id: string): Promise<Room | null>
  /** Moves a room that still exists, gives it `ttlMs` more, and tells every copy. False if it has ended. */
  move(id: string, room: Room, ttlMs: number): Promise<boolean>
  /** Ends a room and tells every copy. */
  end(id: string): Promise<void>
  /**
   * Records how many followers one copy of the server has in a room, and returns the total over all
   * copies. A copy's number is only believed for `COUNT_FRESH_MS`, so a copy that dies stops being counted.
   */
  count(id: string, copy: string, followers: number): Promise<number>
  /** Tells every other copy that this one's count for a room has changed. */
  recount(id: string, copy: string): Promise<void>
  /** Hears what happens in any room, from any copy, this one included. */
  listen(heard: (id: string, news: News) => void): void
}

/** How long one copy's follower count is believed. Copies report every few seconds while they have followers. */
export const COUNT_FRESH_MS = 15_000

/** The followers in a room: each copy's latest number, left out once it is too old to believe. */
export function totalFollowers(reports: Iterable<{ followers: number; at: number }>, now: number): number {
  let total = 0
  for (const report of reports) if (now - report.at < COUNT_FRESH_MS) total += report.followers
  return total
}

/** Rooms kept in this process's memory. */
export function memoryRooms(now: () => number = Date.now): RoomStore {
  const rooms = new Map<string, { room: Room; expires: number }>()
  const counts = new Map<string, Map<string, { followers: number; at: number }>>()
  const listeners: ((id: string, news: News) => void)[] = []
  const tell = (id: string, news: News) => {
    for (const heard of listeners) heard(id, news)
  }
  const forgetExpired = () => {
    for (const [id, { expires }] of rooms) if (expires <= now()) forget(id)
  }
  const forget = (id: string) => {
    rooms.delete(id)
    counts.delete(id)
  }

  return {
    kind: 'memory',
    create(id, room, ttlMs, maxRooms) {
      forgetExpired()
      if (rooms.has(id)) return Promise.resolve('taken')
      if (rooms.size >= maxRooms) return Promise.resolve('full')
      rooms.set(id, { room, expires: now() + ttlMs })
      return Promise.resolve('created')
    },
    get(id) {
      forgetExpired()
      return Promise.resolve(rooms.get(id)?.room ?? null)
    },
    move(id, room, ttlMs) {
      forgetExpired()
      if (!rooms.has(id)) return Promise.resolve(false)
      rooms.set(id, { room, expires: now() + ttlMs })
      tell(id, { kind: 'moved', at: room.at })
      return Promise.resolve(true)
    },
    end(id) {
      forget(id)
      tell(id, { kind: 'ended' })
      return Promise.resolve()
    },
    count(id, copy, followers) {
      const reports = counts.get(id) ?? new Map<string, { followers: number; at: number }>()
      if (followers > 0) reports.set(copy, { followers, at: now() })
      else reports.delete(copy)
      if (rooms.has(id) && reports.size > 0) counts.set(id, reports)
      else counts.delete(id)
      return Promise.resolve(totalFollowers(reports.values(), now()))
    },
    recount(id, copy) {
      tell(id, { kind: 'counted', by: copy })
      return Promise.resolve()
    },
    listen(heard) {
      listeners.push(heard)
    },
  }
}
