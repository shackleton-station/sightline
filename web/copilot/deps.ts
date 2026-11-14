import type { HorizonsAsk } from '../shared/tools/horizonsTool'
import type { Model } from './model'

export type { Model } from './model'

/**
 * What the co-pilot's two handlers (`/api/chat`, `/api/ask`) need from outside themselves. The
 * service's own `CopilotServiceDeps` (app.ts) adds what only the program needs.
 */
export interface CopilotDeps {
  /** The language model; null when no Google Cloud project is configured. */
  model: Model | null
  /** Extra origins allowed to call the API (local dev). The site's own is always allowed. */
  allowedOrigins: string[]
  /** Addresses of our own proxies (the load balancer), skipped when working out who the visitor is. */
  trustedProxies?: string[]
  /**
   * What a kept answer depends on: the co-pilot's code and the site data (`answerVersion` in
   * chat/handler.ts). Answers kept under one value are never given under another.
   */
  answerVersion?: string
  /** The clock, for rate limits and the circuit breaker. */
  now?: () => number
  /** The way to ask NASA JPL Horizons, for Scout's tool that checks an hour with it (horizons.ts). */
  horizons?: HorizonsAsk
}
