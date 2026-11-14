import { resolve } from 'node:path'
import { format } from 'node:util'
import { serve } from '@hono/node-server'
import { readDataVersion } from '../shared/dataVersionFile'
import { cloudTraces, googleToken } from '../shared/google'
import { googleKeys, googleTokens } from '../shared/googleJwt'
import { googleIdentity } from '../shared/identity'
import { statusCaller } from '../shared/statusCaller'
import { serviceLog } from '../shared/log'
import { openRedis } from '../shared/redisClient'
import { redisStore } from '../shared/redisStore'
import { memoryStore } from '../shared/store'
import { createPlansApp } from './app'
import { firestorePlans } from './firestorePlans'
import { memoryPlans } from './store'

/**
 * Starts the plans service. Settings come from the environment:
 * - PORT (Cloud Run sets it; 8082 locally, beside the web server's 8080 and the events worker's 8081)
 * - DATA_DIR: the pipeline's JSON, default ./data (the image carries it there; locally, public/data)
 * - GOOGLE_CLOUD_PROJECT and PLANS_DATABASE: the Firestore database for plans. Without both, plans
 *   are kept in this process's memory, which is only for one machine: on Cloud Run the service
 *   refuses to start, because plans kept in memory are lost when the copy stops
 * - FIRESTORE_HOST: the Firestore API's address, only to point the service at the emulator
 * - REDIS_HOST, REDIS_PORT: Redis for rate limits shared by every copy; without them, memory
 * - GOOGLE_CLIENT_ID: the OAuth client id for sign-in with Google; without it, plans have no owners
 * - ALLOWED_ORIGINS: extra origins for the API, comma-separated (local dev)
 * - TRUSTED_PROXIES: addresses of our own proxies, comma-separated (the load balancer's IP)
 * - TRACING=on: send a trace of each request to Cloud Trace
 * - SERVICE_VERSION: the commit the image was built from (the Dockerfile sets it)
 * - STATUS_CALLER: the web server's service account, the one caller of /api/plans/status/web;
 *   STATUS_AUDIENCE: the audience its token must name (this service's name). Without both, that
 *   path answers 503
 * - DATA_VERSION_FILE: where the image keeps the hash of the site data, default ./data-version.json
 *   (DATA_VERSION: the hash itself, when there is no such file, as in `npm run dev:server`)
 */
const env = process.env
const project = env.GOOGLE_CLOUD_PROJECT
const version = env.SERVICE_VERSION ?? 'dev'
// Straight to standard output: `console` is pointed at this log just below.
const log = serviceLog('plans', version, project, (line) => void process.stdout.write(`${line}\n`))

// The shared modules (Redis, sign-in, the handler) report through `console`. Sending those lines
// through the service's log gives every line this process writes the service's name and version,
// and, inside a request, the ids that tie it to the request's trace.
console.log = (...parts: unknown[]) => log.info(format(...parts))
console.warn = (...parts: unknown[]) => log.warn(format(...parts))
console.error = (...parts: unknown[]) => log.error(format(...parts))

if (env.K_SERVICE && !(project && env.PLANS_DATABASE)) {
  throw new Error('PLANS_DATABASE is not set: the plans service will not run on Cloud Run with plans kept in memory')
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const token = googleToken()
const redis = env.REDIS_HOST ? openRedis(env.REDIS_HOST, Number(env.REDIS_PORT ?? 6379)) : null

const app = createPlansApp({
  dataDir: resolve(env.DATA_DIR ?? 'data'),
  plans: project && env.PLANS_DATABASE ? firestorePlans({ project, database: env.PLANS_DATABASE, host: env.FIRESTORE_HOST }, token) : memoryPlans(),
  identity: env.GOOGLE_CLIENT_ID ? googleIdentity(env.GOOGLE_CLIENT_ID) : null,
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  trustedProxies: list(env.TRUSTED_PROXIES),
  store: redis ? redisStore(redis.store, memoryStore()) : memoryStore(),
  limitsReachable: redis ? () => redis.client.isReady : undefined,
  redis: redis?.connection,
  traces: project && env.TRACING === 'on' ? cloudTraces(project, token) : null,
  version,
  dataVersion: readDataVersion(resolve(env.DATA_VERSION_FILE ?? 'data-version.json')) ?? env.DATA_VERSION ?? null,
  revision: env.K_REVISION ?? null,
  statusCheck: env.STATUS_CALLER && env.STATUS_AUDIENCE ? statusCaller({ tokens: googleTokens(googleKeys, Date.now, 'Status caller check'), audience: env.STATUS_AUDIENCE, caller: env.STATUS_CALLER }) : null,
})

const port = Number(env.PORT ?? 8082)
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => log.info(`listening on :${port}`))

/**
 * Cloud Run sends SIGTERM before it stops a copy, and gives it CPU for 10 more seconds. Stop taking
 * new requests, let the ones in hand finish, then exit. A save cut off here is safe to send again:
 * with an idempotency key the retry either finds the plan already saved or saves it once.
 * The timer is the backstop for a connection a browser keeps open with nothing on it.
 */
process.on('SIGTERM', () => {
  log.info('stopping: finishing the requests in hand')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 8000).unref()
})
