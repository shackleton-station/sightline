import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { firestoreStatsReader, workerStatsReader } from '../shared/firestoreStats'
import { readDataVersion } from '../shared/dataVersionFile'
import { cloudTraces, gcsBucket, googleToken } from '../shared/google'
import { googleSpeech } from './google'
import { connectRedis } from './redisClient'
import { metadataIdTokens, serviceStatuses } from './services'
import { redisStore } from '../shared/redisStore'
import { redisRooms } from './rooms/redisRooms'
import { memoryRooms } from './rooms/store'
import { memoryStore } from '../shared/store'

/**
 * Starts the web server. Settings come from the environment:
 * - PORT (Cloud Run sets it; 8080 locally)
 * - DIST_DIR: the built site, default ./dist
 * - ASSET_BUCKET: the Cloud Storage bucket with tiles/ and media/
 * - GOOGLE_CLOUD_PROJECT: the project traces go to, the counters database is in, and (for a
 *   developer's own token) Scout's voice is billed to
 * - ALLOWED_ORIGINS: extra origins for the API, comma-separated (local dev)
 * - TRUSTED_PROXIES: addresses of our own proxies, comma-separated (the load balancer's IP)
 * - REDIS_HOST, REDIS_PORT: Redis for shared rate limits, kept voice clips and presenters' rooms; without them, memory
 * - REDIS_READ_HOST, REDIS_READ_PORT: the instance's read endpoint, when it has read replicas: kept
 *   voice clips are read from it, everything else stays on REDIS_HOST
 * - FOLLOW=off: switches "Follow the presenter" off; /api/rooms then answers 503
 * - GOOGLE_CLIENT_ID: the OAuth client id for sign-in with Google, handed to the page in /api/status.
 *   The plans service is the one that checks sign-in tokens
 * - STATS_DATABASE: the Firestore database the events worker keeps the day's counts in, read-only here;
 *   STATS_URL: on one machine, the events worker's /counts address instead. Without either, /api/stats answers 503
 * - TRACING=on: send a trace of each API request to Cloud Trace
 * - VOICE=on: say Scout's answers with Cloud Text-to-Speech; VOICE_NAME picks the voice. Without it,
 *   /api/speak answers 503 and the page uses the browser's own voice
 * - PLANS_URL, COPILOT_URL: only on one machine, where there is no load balancer: the plans
 *   service's and the co-pilot service's addresses. /api/plans and /api/plans/* are passed on to the
 *   first, /api/chat, /api/chat/* and /api/ask to the second. Never set in the cloud: there the load
 *   balancer sends those paths to their services, and this server answers 404 for them
 * - PLANS_STATUS_URL, COPILOT_STATUS_URL: the two services' own addresses, which /api/status/services
 *   asks how they are. On Cloud Run it asks with an identity token for the audience PLANS_AUDIENCE or
 *   COPILOT_AUDIENCE (default: the services' names, clps-plans and clps-copilot); elsewhere it asks
 *   their public status. Without an address, that service is reported "not asked"
 *
 * Not read any more, since the co-pilot and plans left this server: GEMINI_MODEL, VERTEX_LOCATION,
 * COPILOT, EVENTS_TOPIC, EVENTS_PUSH_URL, PLANS_DATABASE, COPILOT_VERSION_FILE, COPILOT_CODE_VERSION.
 */
const env = process.env
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const token = googleToken()
const redis = env.REDIS_HOST ? connectRedis(env.REDIS_HOST, Number(env.REDIS_PORT ?? 6379), env.REDIS_READ_HOST ? { host: env.REDIS_READ_HOST, port: Number(env.REDIS_READ_PORT ?? 6379) } : null) : null
const distDir = resolve(env.DIST_DIR ?? 'dist')
const project = env.GOOGLE_CLOUD_PROJECT

const app = createApp({
  distDir,
  bucket: env.ASSET_BUCKET ? gcsBucket(env.ASSET_BUCKET, token) : null,
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  trustedProxies: list(env.TRUSTED_PROXIES),
  store: redis ? redisStore(redis.store, memoryStore()) : memoryStore(),
  redis: redis?.connection,
  rooms: env.FOLLOW === 'off' ? null : redis ? redisRooms(redis.rooms) : memoryRooms(),
  stats: env.STATS_URL ? workerStatsReader(env.STATS_URL) : project && env.STATS_DATABASE ? firestoreStatsReader({ project, database: env.STATS_DATABASE }, token) : null,
  // The hash of the site data, written beside the built site by `vite build` (vite.config.ts).
  dataVersion: readDataVersion(join(distDir, 'data-version.json')),
  traces: env.GOOGLE_CLOUD_PROJECT && env.TRACING === 'on' ? cloudTraces(env.GOOGLE_CLOUD_PROJECT, token) : null,
  // GOOGLE_OAUTH_ACCESS_TOKEN is a developer's own token (`npm run dev:server`), which has to name the project to bill.
  speech: env.VOICE === 'on' ? googleSpeech({ voice: env.VOICE_NAME ?? 'en-US-Chirp3-HD-Leda', billTo: env.GOOGLE_OAUTH_ACCESS_TOKEN ? env.GOOGLE_CLOUD_PROJECT : undefined }, token) : null,
  signInClientId: env.GOOGLE_CLIENT_ID || null,
  plansUrl: env.PLANS_URL ?? null,
  copilotUrl: env.COPILOT_URL ?? null,
  services:
    env.PLANS_STATUS_URL || env.COPILOT_STATUS_URL
      ? serviceStatuses(
          [
            { name: 'plans', url: env.PLANS_STATUS_URL ?? null, statusPath: '/api/plans/status', webPath: '/api/plans/status/web', audience: env.PLANS_AUDIENCE ?? 'clps-plans' },
            { name: 'copilot', url: env.COPILOT_STATUS_URL ?? null, statusPath: '/api/chat/status', webPath: '/api/chat/status/web', audience: env.COPILOT_AUDIENCE ?? 'clps-copilot' },
          ],
          // Only Cloud Run has a metadata server to give this server's identity tokens.
          env.K_SERVICE ? metadataIdTokens() : null,
        )
      : null,
})

const port = Number(env.PORT ?? 8080)
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Listening on :${port}`)
})

// Cloud Run sends SIGTERM before stopping an instance, and gives it CPU for 10 more seconds: finish
// what is in flight, then exit. Nothing here is waiting to be sent anywhere.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
