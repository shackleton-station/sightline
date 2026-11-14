import { ADDRESS_WRITTEN } from './address'
import { type Address, addressOf, addressText, readAddress, roomFrom } from './follow'
import { latestOnly } from './latest'

/**
 * The browser's side of "Follow the presenter". A tab is presenting, following, or neither, and
 * stays so from page to page (each tab of the site is its own document) through `sessionStorage`,
 * which belongs to this browser tab alone and is gone when it closes.
 */
export type FollowState =
  | { role: 'none' }
  /** `followers` is null until the server has said; `trouble` while the server can't be reached. */
  | { role: 'presenter'; room: string; followers: number | null; trouble: boolean }
  | { role: 'follower'; room: string; connected: boolean }
  /** Something ended, and the page says so until it is dismissed. */
  | { role: 'over'; why: 'ended' | 'full' | 'expired' | 'unavailable' | 'busy' }

/** A presenter's address is published at most this often: the first change at once, then the newest. */
const PUBLISH_EVERY_MS = 1000
/**
 * How often the page looks at its own address, in case it was rewritten by something that didn't say so.
 * The site's own pages say so (lib/address.ts), and are heard at once.
 */
const LOOK_EVERY_MS = 200
const RETRY_MS = 5000
/** The address is sent again this often, moved or not, so the room stays open while its presenter's page is. */
const STILL_HERE_MS = 4 * 60_000
/** A stream that has been silent this long is shown as trouble; a reconnect on time is not. */
const TROUBLE_AFTER_MS = 4000

const PRESENTING = 'follow:presenting'
const ROOM = 'follow:room'
const WENT_TO = 'follow:went-to'

// sessionStorage can be switched off; then the tab still works, and forgets when it changes page.
const spare = new Map<string, string>()
function recall(name: string): string | null {
  try {
    return window.sessionStorage.getItem(name)
  } catch {
    return spare.get(name) ?? null
  }
}
function keep(name: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(name)
    else window.sessionStorage.setItem(name, value)
  } catch {
    if (value === null) spare.delete(name)
    else spare.set(name, value)
  }
}

let state: FollowState = { role: 'none' }
const listeners = new Set<() => void>()
function set(next: FollowState) {
  state = next
  for (const listener of listeners) listener()
}
/** For React's useSyncExternalStore. */
export const followStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
  get: () => state,
}

/** Stops whatever this page has running: its stream and its timers. */
let stop: () => void = () => {}

/**
 * Listens to a room. The browser reconnects by itself when a stream ends on time or the connection
 * drops. It does not when the answer is a refusal (the edge firewall's 429, a server with no room
 * for another stream): then this waits, longer each time and not in step with other phones, and asks again.
 */
function listenTo(url: string, heard: (event: string, data: unknown) => void, trouble: (now: boolean) => void): () => void {
  let source: EventSource | null = null
  let again = 0
  let worry = 0
  let refusals = 0
  const connect = () => {
    source = new EventSource(url)
    for (const name of ['at', 'count', 'ended', 'full']) {
      source.addEventListener(name, (event) => {
        refusals = 0
        window.clearTimeout(worry)
        trouble(false)
        try {
          heard(name, JSON.parse((event as MessageEvent<string>).data))
        } catch {
          // Not something the server sends: ignore it.
        }
      })
    }
    source.onerror = () => {
      window.clearTimeout(worry)
      worry = window.setTimeout(() => trouble(true), TROUBLE_AFTER_MS)
      if (source?.readyState !== EventSource.CLOSED) return
      again = window.setTimeout(connect, Math.min(30_000, 2000 * 2 ** refusals) * (0.5 + Math.random()))
      refusals += 1
    }
  }
  connect()
  return () => {
    source?.close()
    window.clearTimeout(again)
    window.clearTimeout(worry)
  }
}

/**
 * Takes this page to where the presenter is. Another tab is a page load. On the same tab only the
 * part after "#" changes, and the page hears "hashchange" as it would for a pasted link: no reload,
 * and nothing added to the Back button. The address is checked again here, so nothing but a page
 * of this site can come out of it.
 */
function goTo(value: unknown) {
  const at = readAddress(value)
  if (!at) return
  const to = addressText(at)
  // Each address is acted on once. A follower who has looked around since stays there until the presenter moves.
  if (recall(WENT_TO) === to) return
  keep(WENT_TO, to)
  const here = addressOf(window.location)
  if (!here || here.path !== at.path || here.query !== at.query) return window.location.assign(to)
  if (here.hash === at.hash) return
  const from = window.location.href
  window.history.replaceState(window.history.state, '', to)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: from, newURL: window.location.href }))
}

function follow(room: string) {
  const over = (why: 'ended' | 'full') => {
    stop()
    keep(ROOM, null)
    keep(WENT_TO, null)
    set({ role: 'over', why })
  }
  set({ role: 'follower', room, connected: false })
  stop = listenTo(
    `/api/rooms/${room}/events`,
    (event, data) => {
      if (event === 'at') goTo(data)
      else if (event === 'ended' || event === 'full') over(event)
    },
    (trouble) => {
      if (state.role === 'follower' && state.connected === trouble) set({ role: 'follower', room, connected: !trouble })
    },
  )
}

interface Presenting {
  room: string
  key: string
}

function presentingNow(): Presenting | null {
  try {
    const kept = JSON.parse(recall(PRESENTING) ?? 'null') as Partial<Presenting> | null
    return typeof kept?.room === 'string' && typeof kept.key === 'string' ? { room: kept.room, key: kept.key } : null
  } catch {
    return null
  }
}

function present(mine: Presenting) {
  const show = (change: { followers?: number; trouble?: boolean }) => {
    if (state.role !== 'presenter') return
    const next = { ...state, ...change }
    if (next.followers !== state.followers || next.trouble !== state.trouble) set(next)
  }
  // The room ran out (a laptop closed for ten minutes, or three hours in all) or was ended from elsewhere.
  const over = () => {
    stop()
    keep(PRESENTING, null)
    set({ role: 'over', why: 'expired' })
  }
  set({ role: 'presenter', room: mine.room, followers: null, trouble: false })

  const publish = latestOnly<Address>(
    async (at) => {
      const response = await fetch(`/api/rooms/${mine.room}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-presenter-key': mine.key },
        body: JSON.stringify({ at }),
      }).catch(() => null)
      // The room is gone (it ran out, or was stopped from another page): say so, and stop sending.
      if (response?.status === 404 || response?.status === 403) over()
      // Any other refusal of this address won't change by asking again; a busy or unreachable server will.
      const retry = !response || response.status === 429 || response.status >= 500
      show({ trouble: retry })
      return !retry
    },
    PUBLISH_EVERY_MS,
    RETRY_MS,
  )
  let last = ''
  const look = () => {
    const here = addressOf(window.location)
    if (!here || addressText(here) === last) return
    last = addressText(here)
    publish(here)
  }
  const heard = ['hashchange', 'popstate', ADDRESS_WRITTEN]
  for (const event of heard) window.addEventListener(event, look)
  const looking = window.setInterval(look, LOOK_EVERY_MS)
  const stillHere = window.setInterval(() => {
    last = ''
    look()
  }, STILL_HERE_MS)
  look()
  const unlisten = listenTo(
    `/api/rooms/${mine.room}/events?watch`,
    (event, data) => {
      if (event === 'count') show({ followers: Number((data as { followers?: unknown }).followers) || 0 })
      else if (event === 'ended') over()
    },
    () => {},
  )
  stop = () => {
    for (const event of heard) window.removeEventListener(event, look)
    window.clearInterval(looking)
    window.clearInterval(stillHere)
    unlisten()
  }
}

let begun = false
/**
 * Picks up where this tab left off: called once by every page. A link with "?follow=<room>" starts
 * following; the room is then kept for the tab and taken out of the address, so a link copied from
 * a follower's page is an ordinary one.
 */
export function beginFollow() {
  if (begun) return
  begun = true
  const asked = roomFrom(window.location.search)
  if (asked) {
    if (presentingNow()) void stopPresenting()
    if (recall(ROOM) !== asked) keep(WENT_TO, null)
    keep(ROOM, asked)
    const url = new URL(window.location.href)
    url.searchParams.delete('follow')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  const room = recall(ROOM)
  const mine = presentingNow()
  if (room) follow(room)
  else if (mine) present(mine)
}

/** Starts a room where this page is. True if it started. */
export async function startPresenting(): Promise<boolean> {
  const at = addressOf(window.location)
  const response = at ? await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at }) }).catch(() => null) : null
  const made = response?.ok ? ((await response.json().catch(() => null)) as Partial<{ id: string; key: string }> | null) : null
  if (typeof made?.id !== 'string' || typeof made.key !== 'string') {
    set({ role: 'over', why: response?.status === 429 ? 'busy' : 'unavailable' })
    return false
  }
  stop()
  keep(ROOM, null)
  keep(PRESENTING, JSON.stringify({ room: made.id, key: made.key }))
  present({ room: made.id, key: made.key })
  return true
}

/** Ends the room for everyone. The presenter's own page stops at once, whatever the server answers. */
export async function stopPresenting() {
  const mine = presentingNow()
  stop()
  keep(PRESENTING, null)
  set({ role: 'none' })
  if (mine) await fetch(`/api/rooms/${mine.room}`, { method: 'DELETE', headers: { 'x-presenter-key': mine.key } }).catch(() => null)
}

/** Stops following. The page stays where it is. */
export function stopFollowing() {
  stop()
  keep(ROOM, null)
  keep(WENT_TO, null)
  set({ role: 'none' })
}

/** Puts away the note that something ended. */
export function dismissFollow() {
  if (state.role === 'over') set({ role: 'none' })
}
