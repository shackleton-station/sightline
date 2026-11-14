import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type { EventSink } from '../shared/events'
import type { SharedStore } from '../shared/store'
import type { TraceSink } from '../shared/trace'
import { createCopilotApp } from './app'
import type { Breaker } from './breaker'
import type { Model } from './model'
import { memoryOutbox, outboxRelay, type Relay } from './outbox'

/** What the co-pilot tests share. Not part of the service: only test files import this. */

export const dataDir = fileURLToPath(new URL('../public/data', import.meta.url))
export const ORIGIN = 'https://clps-web.example.run.app'

export interface Overrides {
  model?: Model | null
  events?: EventSink | null
  relay?: Relay | null
  traces?: TraceSink | null
  store?: SharedStore
  breaker?: Breaker
  now?: () => number
  trustedProxies?: string[]
  allowedOrigins?: string[]
  /** Retries wait for nothing in tests, unless a test passes its own clock. */
  retry?: { wait?: (ms: number) => Promise<void>; random?: () => number }
}

const noWait = { wait: async () => {}, random: () => 0.5 }

/**
 * The one program that answers /api/chat and /api/ask: the co-pilot service. This was a list of two
 * while the web server could answer them too, and the tests ran against both. The web server's
 * co-pilot code is gone (server/app.test.ts checks it answers 404 there), so they run against the
 * service alone.
 */
export const PROGRAMS: { name: string; site: (overrides?: Overrides) => Hono }[] = [
  {
    name: 'the co-pilot service',
    site: ({ events, relay, ...overrides } = {}) =>
      createCopilotApp({ dataDir, bucket: null, model: null, allowedOrigins: [], version: 'test', codeVersion: 'test', dataVersion: 'test', revision: null, relay: relay !== undefined ? relay : events ? testRelay(events, overrides.now) : null, ...overrides, retry: { ...noWait, ...overrides.retry } }),
  },
]

/** The service is handed a relay; a test that only passes `events` gets one made in memory. */
function testRelay(events: EventSink, now?: () => number): Relay {
  return outboxRelay(events, memoryOutbox(), now)
}
