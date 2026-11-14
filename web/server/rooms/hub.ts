import { randomUUID } from 'node:crypto'
import { type Address, addressText } from '../../src/lib/follow'
import type { RoomStore } from './store'

export interface HubRules {
  /** A stream is ended this long after it opens, and the browser connects again. Under Cloud Run's request limit (60 s, infra/main.tf). */
  streamMs: number
  /** How often a copy re-reads its rooms: its report of its own followers, and the repair for a missed message. */
  refreshMs: number
  /** Followers in one room, over all copies. */
  maxFollowers: number
  /** Streams one copy holds, of every room together. Under Cloud Run's 80 requests at once per copy, so pages still load. */
  maxStreams: number
}

/** Joins and leaves come in bursts (a presenter changes tab and every phone reconnects); they are counted once, this long after. */
const COUNT_AFTER_MS = 150

const encoder = new TextEncoder()
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // The co-pilot's stream headers: nothing between here and the browser may hold the stream back or rewrite it.
  'cache-control': 'no-store, no-transform',
  'x-accel-buffering': 'no',
}

/** A stream that says one thing and ends, for a room that is over or full. */
export function sayOnce(event: 'ended' | 'full'): Response {
  return new Response(frame(event, {}), { headers: HEADERS })
}

interface Follower {
  body: ReadableStream<Uint8Array>
  /** Whether this stream is a follower. The presenter's own, which only watches the count, is not. */
  counted: boolean
  move(at: Address): void
  count(followers: number): void
  /** Ends the stream, with a last event if there is something to say. Without one the browser connects again. */
  end(event?: 'ended'): void
}

/**
 * One browser's stream of server-sent events. Only the newest matters, so it holds one address and
 * one count, not a queue: while the browser is not keeping up, a newer address replaces the one
 * waiting, and the one sent when it catches up is the newest.
 */
function follower(counted: boolean, onClosed: () => void): Follower {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let at: Address | null = null
  let followers: number | null = null
  let sentAt = ''
  let sentFollowers: number | null = null
  let closed = false
  /** What is waiting to be said, as text; '' if nothing new. */
  const waiting = () => {
    let text = ''
    if (at && addressText(at) !== sentAt) {
      text += frame('at', at)
      sentAt = addressText(at)
    }
    if (followers !== null && followers !== sentFollowers) {
      text += frame('count', { followers })
      sentFollowers = followers
    }
    at = null
    followers = null
    return text
  }
  const flush = () => {
    // The one chunk the stream holds has not been taken yet: keep what is waiting for when it is (`pull`).
    if (closed || (controller.desiredSize ?? 0) <= 0) return
    const text = waiting()
    if (text) controller.enqueue(encoder.encode(text))
  }
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started
      // If the connection drops, the browser waits this long before connecting again.
      controller.enqueue(encoder.encode('retry: 1000\n\n'))
    },
    pull: flush,
    cancel() {
      if (closed) return
      closed = true
      onClosed()
    },
  })
  return {
    body,
    counted,
    move(next) {
      at = next
      flush()
    },
    count(next) {
      followers = next
      flush()
    },
    end(event) {
      if (closed) return
      closed = true
      const text = waiting() + (event ? frame(event, {}) : '')
      if (text) controller.enqueue(encoder.encode(text))
      controller.close()
      onClosed()
    },
  }
}

/**
 * The followers connected to this copy of the server, by room. It passes on what the store says
 * about a room (from any copy), reports this copy's follower count, and every few seconds reads
 * each room again, which also notices a room that has expired.
 */
export function roomHub(store: RoomStore, rules: HubRules) {
  /** This copy's name in the follower counts. */
  const copy = randomUUID()
  const rooms = new Map<string, { streams: Set<Follower>; refresh: ReturnType<typeof setInterval>; counting: ReturnType<typeof setTimeout> | null }>()
  let streams = 0
  let lastComplaint = Number.NEGATIVE_INFINITY
  const complain = (error: unknown) => {
    if (Date.now() - lastComplaint < 60_000) return
    lastComplaint = Date.now()
    console.warn('Rooms: the store is unavailable; followers keep the page they are on:', error instanceof Error ? error.message : error)
  }
  const countedIn = (id: string) => [...(rooms.get(id)?.streams ?? [])].filter((stream) => stream.counted).length

  /** Reports this copy's followers in a room and shows everyone here the total. */
  const tally = async (id: string) => {
    const total = await store.count(id, copy, countedIn(id))
    for (const stream of rooms.get(id)?.streams ?? []) stream.count(total)
  }
  /** After a join or a leave: count once the burst is over, then tell the other copies to look. */
  const countSoon = (id: string) => {
    const room = rooms.get(id)
    if (!room || room.counting) return
    room.counting = setTimeout(() => {
      room.counting = null
      tally(id)
        .then(() => store.recount(id, copy))
        .catch(complain)
    }, COUNT_AFTER_MS)
  }
  const endRoom = (id: string) => {
    for (const stream of [...(rooms.get(id)?.streams ?? [])]) stream.end('ended')
  }
  /** Reads a room again: its address in case a message was missed, its end if it has expired, and the count. */
  const refresh = async (id: string) => {
    const room = await store.get(id)
    if (!room) return endRoom(id)
    for (const stream of rooms.get(id)?.streams ?? []) stream.move(room.at)
    await tally(id)
  }

  store.listen((id, news) => {
    const room = rooms.get(id)
    if (!room) return
    if (news.kind === 'moved') for (const stream of room.streams) stream.move(news.at)
    else if (news.kind === 'ended') endRoom(id)
    else if (news.by !== copy) tally(id).catch(complain)
  })

  const leave = (id: string, stream: Follower, timer: ReturnType<typeof setTimeout>) => {
    clearTimeout(timer)
    const room = rooms.get(id)
    if (!room?.streams.delete(stream)) return
    streams -= 1
    if (room.streams.size > 0) return countSoon(id)
    // The last one here has gone: stop reading the room, and take this copy out of its count.
    clearInterval(room.refresh)
    if (room.counting) clearTimeout(room.counting)
    rooms.delete(id)
    store
      .count(id, copy, 0)
      .then(() => store.recount(id, copy))
      .catch(complain)
  }

  return {
    /** How many streams this copy holds. */
    streams: () => streams,
    /**
     * A stream of a room: its address at once, then each change and the follower count. 'busy' when
     * this copy holds all the streams it may (the browser tries again, and may reach another copy).
     */
    async open(id: string, counted: boolean): Promise<Response | 'busy'> {
      const found = await store.get(id)
      if (!found) return sayOnce('ended')
      if (streams >= rules.maxStreams) return 'busy'
      if (counted && (await store.count(id, copy, countedIn(id))) >= rules.maxFollowers) return sayOnce('full')

      const room = rooms.get(id) ?? { streams: new Set<Follower>(), refresh: setInterval(() => void refresh(id).catch(complain), rules.refreshMs), counting: null }
      rooms.set(id, room)
      const stream: Follower = follower(counted, () => leave(id, stream, timer))
      // Ended on time, cleanly, before the platform cuts the request off; the browser then connects again.
      const timer = setTimeout(() => stream.end(), rules.streamMs)
      room.streams.add(stream)
      streams += 1
      stream.move(found.at)
      countSoon(id)
      return new Response(stream.body, { headers: HEADERS })
    },
  }
}

export type RoomHub = ReturnType<typeof roomHub>
