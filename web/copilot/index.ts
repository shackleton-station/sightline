import { resolve } from 'node:path'
import { format } from 'node:util'
import { serve } from '@hono/node-server'
import { readVersionFile } from '../shared/dataVersionFile'
import { cloudTraces, gcsBucket, googleToken } from '../shared/google'
import { googleKeys, googleTokens } from '../shared/googleJwt'
import { serviceLog } from '../shared/log'
import { redisStore } from '../shared/redisStore'
import { statusCaller } from '../shared/statusCaller'
import { memoryStore } from '../shared/store'
import { createCopilotApp } from './app'
import { memoryBreaker, redisBreaker } from './breaker'
import { claudeClient, claudeModel, describeAuth, describeClaude, readClaudeAuth, readClaudeSettings } from './claude'
import { clusterCache, openCluster } from './clusterCache'
import { directPush, pubsubEvents } from './google'
import type { Model } from './model'
import { MODEL_CALL_TIMEOUT_MS } from './modelCall'
import { memoryOutbox, outboxRelay, redisOutbox } from './outbox'
import { connectCopilotRedis } from './redisClient'
import { faultyModel, readFaults, scriptedModel } from './standIns'
import { limitsFrom } from './limits'

/**
 * Starts the co-pilot service. Settings come from the environment:
 * - PORT (Cloud Run sets it; 8083 locally, beside the web server's 8080, the events worker's 8081 and plans' 8082)
 * - DATA_DIR: the pipeline's JSON, default ./data (the image carries it there; locally, public/data)
 * - How it signs in to the Anthropic API (claude.ts), with no stored key:
 *   ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID and,
 *   optionally, ANTHROPIC_WORKSPACE_ID: Workload Identity Federation, with Google's identity token
 *   for the service's own account (identifiers, not secrets; Terraform sets them).
 *   ANTHROPIC_IDENTITY_FROM_GCLOUD=<service account>: on a laptop, get that token from gcloud by
 *   impersonating the account. Refused on Cloud Run.
 *   ANTHROPIC_API_KEY: a developer's own key, from their environment and never from a file in the
 *   repository; used only when the federation settings are absent.
 *   With none of these the co-pilot answers 503 "not-configured" (unless FAKE_MODEL=on)
 * - CLAUDE_MODEL, CLAUDE_SPEED, CLAUDE_EFFORT: which Claude, its speed and effort (claude.ts has
 *   the defaults: claude-opus-5-5, fast, low). An empty CLAUDE_SPEED sends no speed field
 * - GOOGLE_CLOUD_PROJECT: the project for Pub/Sub, Cloud Trace and the bucket
 * - ASSET_BUCKET: the bucket with the light grid's months, for the tool that looks up tapped ground
 * - REDIS_HOST, REDIS_PORT: Redis for rate limits, kept answers, the event outbox and the circuit
 *   breaker, shared by every copy; without them, this process's memory
 * - REDIS_READ_HOST, REDIS_READ_PORT: the instance's read endpoint, when it has read replicas. Kept
 *   answers are read from it; everything else stays on REDIS_HOST. Without it, one connection
 * - CACHE_CLUSTER_HOST, CACHE_CLUSTER_PORT: a Redis Cluster's discovery endpoint. Kept answers, and
 *   nothing else, then live on the cluster (clusterCache.ts). Off unless set
 * - EVENTS_TOPIC: the Pub/Sub topic for question events; EVENTS_PUSH_URL: on one machine, the
 *   events worker's /push address instead. Without either, nothing is logged
 * - ALLOWED_ORIGINS: extra origins for the API, comma-separated (local dev)
 * - TRUSTED_PROXIES: addresses of our own proxies, comma-separated (the load balancer's IP)
 * - TRACING=on: send a trace of each request to Cloud Trace
 * - STATUS_CALLER: the web server's service account, the one caller of /api/chat/status/web;
 *   STATUS_AUDIENCE: the audience its token must name (this service's name). Without both, that
 *   path answers 503
 * - MODEL_FAULTS=<status>@<percent>: answer that share of model calls with that error, without
 *   calling the model, to show the circuit breaker working (docs/ARCHITECTURE_PHASE_3.md). Off unless set
 * - FAKE_MODEL=on: a scripted stand-in answers instead of Claude, for a laptop or Compose. Refused on
 *   Cloud Run. FAKE_MODEL_DELAY_MS slows each of its answers, to watch a stream or a shutdown
 * - SERVICE_VERSION: the commit the image was built from (the Dockerfile sets it)
 * - DATA_VERSION_FILE, CODE_VERSION_FILE: where the image keeps the hashes of the site data and of the
 *   co-pilot's code, default ./data-version.json and ./copilot-version.json (DATA_VERSION and
 *   CODE_VERSION: the hashes themselves, when there are no such files, as in `npm run dev:server`)
 */
const env = process.env
const project = env.GOOGLE_CLOUD_PROJECT
const version = env.SERVICE_VERSION ?? 'dev'
// Straight to standard output: `console` is pointed at this log just below.
const log = serviceLog('copilot', version, project, (line) => void process.stdout.write(`${line}\n`))

// The shared modules (Redis, the outbox, the handlers) report through `console`. Sending those lines
// through the service's log gives every line this process writes the service's name and version,
// and, inside a request, the ids that tie it to the request's trace.
console.log = (...parts: unknown[]) => log.info(format(...parts))
console.warn = (...parts: unknown[]) => log.warn(format(...parts))
console.error = (...parts: unknown[]) => log.error(format(...parts))

if (env.K_SERVICE && env.FAKE_MODEL === 'on') throw new Error('FAKE_MODEL=on is for a laptop: the co-pilot will not run on Cloud Run with a scripted stand-in for the model')

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const token = googleToken()
const redis = env.REDIS_HOST
  ? connectCopilotRedis(env.REDIS_HOST, Number(env.REDIS_PORT ?? 6379), env.REDIS_READ_HOST ? { host: env.REDIS_READ_HOST, port: Number(env.REDIS_READ_PORT ?? 6379) } : null)
  : null
const store = redis ? redisStore(redis.store, memoryStore()) : memoryStore()
// The Redis Cluster window: answers on the cluster, falling back to the ordinary cache when it fails.
const cluster = env.CACHE_CLUSTER_HOST ? openCluster(env.CACHE_CLUSTER_HOST, Number(env.CACHE_CLUSTER_PORT ?? 6379)) : null

// Read even with the stand-in, so a mistyped setting stops the service at start, not at the first question.
const claude = readClaudeSettings(env)
const auth = readClaudeAuth(env)
const fake = env.FAKE_MODEL === 'on'
const client = fake ? null : claudeClient(auth, MODEL_CALL_TIMEOUT_MS)
let model: Model | null = fake
  ? scriptedModel({ delayMs: Number(env.FAKE_MODEL_DELAY_MS ?? 0), onCall: (calls) => log.info(`scripted model call ${calls}`) })
  : client
    ? claudeModel(claude, client)
    : null
if (!fake) {
  log.info(
    model
      ? `model: ${describeClaude(claude)}; signs in with ${describeAuth(auth)}`
      : 'model: none (neither the federation settings nor ANTHROPIC_API_KEY are set): /api/chat and /api/ask answer 503 not-configured',
  )
}
const faults = readFaults(env.MODEL_FAULTS)
if (model && faults) {
  model = faultyModel(model, faults)
  log.warn(`MODEL_FAULTS is on: ${faults.percent}% of model calls are answered ${faults.status} without calling the model`)
}

const events = env.EVENTS_PUSH_URL ? directPush(env.EVENTS_PUSH_URL) : project && env.EVENTS_TOPIC ? pubsubEvents({ project, topic: env.EVENTS_TOPIC }, token) : null
// Events go through an outbox on their way to the queue, so one that fails to publish is sent later and not lost.
const relay = events ? outboxRelay(events, redis ? redisOutbox(redis.outbox) : memoryOutbox()) : null
relay?.start()

const app = createCopilotApp({
  dataDir: resolve(env.DATA_DIR ?? 'data'),
  bucket: env.ASSET_BUCKET ? gcsBucket(env.ASSET_BUCKET, token) : null,
  model,
  modelKind: fake ? 'scripted' : faults ? `claude, with ${faults.percent}% of calls failed on purpose (${faults.status})` : 'claude',
  modelSettings: fake ? null : claude,
  modelAuth: auth.kind,
  // One line per model call, for the timing runs and for reading a slow question afterwards. Token
  // counts and times only: never the question, the answer or the key.
  modelCallLog: (call) => log.info('model call', { ...call }),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  trustedProxies: list(env.TRUSTED_PROXIES),
  // How "Check with Horizons" names this service to JPL, whose policy asks for a name and a contact. Unset, a plain name is sent.
  horizonsUserAgent: env.HORIZONS_USER_AGENT || undefined,
  store,
  limitsReachable: redis ? () => redis.client.isReady : undefined,
  redis: redis?.connection,
  answers: cluster ? clusterCache(cluster.commands, store.cache, store.counts) : undefined,
  clusterState: cluster?.state,
  breaker: redis ? redisBreaker(redis.breaker, memoryBreaker()) : memoryBreaker(),
  relay,
  traces: project && env.TRACING === 'on' ? cloudTraces(project, token) : null,
  statusCheck: env.STATUS_CALLER && env.STATUS_AUDIENCE ? statusCaller({ tokens: googleTokens(googleKeys, Date.now, 'Status caller check'), audience: env.STATUS_AUDIENCE, caller: env.STATUS_CALLER }) : null,
  limits: limitsFrom(env),
  version,
  codeVersion: readVersionFile(resolve(env.CODE_VERSION_FILE ?? 'copilot-version.json'), 'codeVersion') ?? env.CODE_VERSION ?? null,
  dataVersion: readVersionFile(resolve(env.DATA_VERSION_FILE ?? 'data-version.json'), 'dataVersion') ?? env.DATA_VERSION ?? null,
  revision: env.K_REVISION ?? null,
})

const port = Number(env.PORT ?? 8083)
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => log.info(`listening on :${port}`))

/**
 * Cloud Run sends SIGTERM before it stops a copy, and gives it 10 more seconds. It normally stops
 * only copies with no request in hand; its contract says it may, "in exceptional cases", stop one
 * that still has some. So: stop taking new connections, close the ones that are idle, and let the
 * requests in hand finish, a streamed answer included, while the outbox sends what is waiting
 * (bounded, so a queue that is down cannot hold the exit). Exit when the last request is done, or
 * after 9 s, before Cloud Run's 10 s are up. An answer cut off by that is lost to the visitor, who
 * can ask again; its question event, if it was kept, is in the outbox for the next copy to send.
 */
process.on('SIGTERM', () => {
  log.info('stopping: finishing the requests in hand')
  const swept = relay ? Promise.race([relay.sweep({ everything: true }), new Promise((done) => setTimeout(done, 3000))]) : Promise.resolve()
  const closed = new Promise<void>((done) => server.close(() => done()))
  ;(server as { closeIdleConnections?: () => void }).closeIdleConnections?.()
  void Promise.all([swept, closed]).then(() => process.exit(0))
  setTimeout(() => process.exit(0), 9000).unref()
})
