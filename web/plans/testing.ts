import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type { Identity } from '../shared/identity'
import type { TraceSink } from '../shared/trace'
import { createPlansApp } from './app'
import { memoryPlans, type PlanStore } from './store'

/** What the plans tests share. Not part of the service: only test files import this. */

export const dataDir = fileURLToPath(new URL('../public/data', import.meta.url))
export const ORIGIN = 'https://clps-web.example.run.app'
export const VIEW = '#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan'

export interface Overrides {
  plans?: PlanStore | null
  identity?: Identity | null
  traces?: TraceSink | null
  now?: () => number
}

/**
 * The one program that answers /api/plans: the plans service. This was a list of two while the web
 * server could answer the path too, and the tests ran against both. The web server's plans code is
 * gone (server/app.test.ts checks it answers 404 there), so they run against the service alone.
 */
export const PROGRAMS: { name: string; site: (overrides?: Overrides) => Hono }[] = [
  { name: 'the plans service', site: (overrides = {}) => createPlansApp({ dataDir, allowedOrigins: [], plans: memoryPlans(), version: 'test', dataVersion: null, revision: null, ...overrides }) },
]

/** A request to save a plan, as the page sends it. `key` is the Idempotency-Key header's value, as given. */
export const save = (body: unknown, init: { origin?: string; visitor?: string; key?: string } = {}) =>
  new Request(`${ORIGIN}/api/plans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: init.origin ?? ORIGIN, 'x-forwarded-for': init.visitor ?? '203.0.113.7', ...(init.key ? { 'idempotency-key': init.key } : {}) },
    body: JSON.stringify(body),
  })

export const idOf = async (response: Response) => ((await response.json()) as { id: string }).id

/** Stands in for Google: a token is good if it is "token-of-<someone>". */
export const identity: Identity = {
  clientId: 'client-id.apps.example',
  verify: (token) => Promise.resolve(token.startsWith('token-of-') ? `owner-${token.slice('token-of-'.length)}` : null),
}

export const as = (who: string | null, request: Request) => {
  if (who) request.headers.set('authorization', `Bearer ${who}`)
  return request
}
