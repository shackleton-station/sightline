import { SITE_PATHS } from './siteTabs'

/**
 * "Follow the presenter": one person presents, and everyone who opens their link sees the same page.
 * What is shared is where the presenter is on this site and nothing else. This file is the part the
 * browser and the server both use: what an address is, and what one may hold.
 */
export interface Address {
  /** One of the site's own pages, such as "/scout/". Never a full URL, so a follower can't be sent off the site. */
  path: string
  /** The part after "?", with its "?"; '' if there is none. */
  query: string
  /** The part after "#", with its "#"; '' if there is none. */
  hash: string
}

/** A room's id: short enough to type, in the alphabet of plan ids (no letters or digits that look alike). */
export const ROOM_ID = /^[a-hj-km-np-z2-9]{6}$/
const FOLLOW_PARAM = 'follow'
const MAX_QUERY = 200
/** As long as the longest view a shared plan may hold (plans/handler.ts). */
const MAX_HASH = 1500
// The characters a URL allows after "?" and after "#" (RFC 3986), so nothing else can ride along.
const QUERY = /^\?[A-Za-z0-9\-._~!$'()*+,;=:@/?%&]*$/
const HASH = /^#[A-Za-z0-9\-._~!$'()*+,;=:@/?%&]*$/

/** An address a presenter may publish, or null for anything else. The server checks, and so does every follower. */
export function readAddress(value: unknown): Address | null {
  if (typeof value !== 'object' || value === null) return null
  const { path, query, hash } = value as { path?: unknown; query?: unknown; hash?: unknown }
  if (typeof path !== 'string' || typeof query !== 'string' || typeof hash !== 'string') return null
  if (!SITE_PATHS.includes(path)) return null
  // A published address never names a room to follow, so following can't be chained from room to room.
  if (query !== '' && (query.length > MAX_QUERY || !QUERY.test(query) || new URLSearchParams(query).has(FOLLOW_PARAM))) return null
  if (hash !== '' && (hash.length > MAX_HASH || !HASH.test(hash))) return null
  return { path, query, hash }
}

/** An address as the text after the site's name: what a follower's address bar ends in. */
export function addressText({ path, query, hash }: Address): string {
  return `${path}${query}${hash}`
}

/** Where a browser is, as an address to publish; null on a page that isn't one of the tabs. */
export function addressOf(location: { pathname: string; search: string; hash: string }): Address | null {
  const params = new URLSearchParams(location.search)
  params.delete(FOLLOW_PARAM)
  const query = params.size > 0 ? `?${params}` : ''
  return readAddress({ path: location.pathname.replace(/index\.html$/, ''), query, hash: location.hash === '#' ? '' : location.hash })
}

/** The room a link like "/?follow=abc234" asks to follow, or null if it names none. */
export function roomFrom(search: string): string | null {
  const room = new URLSearchParams(search).get(FOLLOW_PARAM)
  return room !== null && ROOM_ID.test(room) ? room : null
}

/**
 * The link an audience opens to follow a room: the site's front page, which is the shortest address
 * to read out or type. From there a follower's page goes to wherever the presenter is.
 */
export function followLink(origin: string, room: string): string {
  return `${origin}/?${FOLLOW_PARAM}=${room}`
}
