import type { Bucket } from '../shared/bucket'
import type { RoomStore } from './rooms/store'
import type { ServiceStatuses } from './services'
import type { RedisConnection } from '../shared/redisClient'
import type { SharedStore } from '../shared/store'
import type { StatsReader } from '../shared/stats'
import type { TraceSink } from '../shared/trace'

export type { Bucket, StoredObject } from '../shared/bucket'

/**
 * What the web server needs from outside itself. Tests pass fakes; `index.ts` passes the real ones.
 *
 * No model, no plans database, no question log: the co-pilot and plans are their own services
 * (`web/copilot/`, `web/plans/`), and nothing here can answer for them. `server/build.test.ts`
 * fails if this server ever imports their code again.
 */
export interface Deps {
  /** The built site (`vite build` output). */
  distDir: string
  /** Where terrain tiles and the demo video live; null when no bucket is configured. */
  bucket: Bucket | null
  /** Extra origins allowed to call the API (local dev). The site's own is always allowed. */
  allowedOrigins: string[]
  /** Rate-limit counts and kept voice clips. Defaults to this process's memory; Redis in production. */
  store?: SharedStore
  /** What the connections to Redis are doing, for `/api/status`. Only passed when the store is on Redis. */
  redis?: RedisConnection
  /**
   * The plans service's address, only when everything runs on one machine (`npm run dev:server`,
   * Compose). There the load balancer's path rule does not exist, so this server passes /api/plans
   * on to the service. Never set in the cloud, where this server answers 404 for that path.
   */
  plansUrl?: string | null
  /** Where presenters' rooms live ("Follow the presenter"). Defaults to this process's memory; Redis in production; null switches it off. */
  rooms?: RoomStore | null
  /**
   * The OAuth client id for sign-in with Google, which the page needs to show Google's button. Not
   * a secret. This server checks no token: the plans service does (shared/identity.ts).
   */
  signInClientId?: string | null
  /** Today's counts of co-pilot questions, kept by the events worker; read-only here. Nothing when not configured. */
  stats?: StatsReader | null
  /** A hash of the site data this build carries, so a deploy can tell that every service holds the same data. */
  dataVersion?: string | null
  /** Where request traces go (Cloud Trace); nothing when not configured. */
  traces?: TraceSink | null
  /** The voice that says Scout's answers; nothing when not switched on, and the page uses the browser's own. */
  speech?: Speech | null
  /** Addresses of our own proxies (the load balancer), skipped when working out who the visitor is. */
  trustedProxies?: string[]
  /** The clock, for rate limits. */
  now?: () => number
  /**
   * The co-pilot service's address, only when everything runs on one machine (`npm run dev:server`,
   * Compose): there this server passes /api/chat, /api/chat/* and /api/ask on to it, as the load
   * balancer's path rule does in the cloud. Never set in the cloud, where it answers 404 for them.
   */
  copilotUrl?: string | null
  /** Asks the plans and co-pilot services how they are, for `/api/status/services`; null: nobody is asked. */
  services?: ServiceStatuses | null
}

export interface Speech {
  /** Says plain text aloud: the bytes of an audio file and its media type. */
  say(text: string, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }>
}
