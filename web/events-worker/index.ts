import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { googleCallers } from '../shared/caller'
import { readDataVersion } from '../shared/dataVersionFile'
import { firestoreStats } from '../shared/firestoreStats'
import { cloudTraces, googleToken } from '../shared/google'
import { googleKeys, googleTokens } from '../shared/googleJwt'
import { serviceLog } from '../shared/log'
import { memoryStats } from '../shared/stats'
import { createWorker } from './app'

/**
 * Starts the events worker. Settings come from the environment:
 * - PORT (Cloud Run sets it; 8081 locally, beside the web server's 8080)
 * - GOOGLE_CLOUD_PROJECT and STATS_DATABASE: the Firestore database for the counts; without both, this process's memory
 * - PUSH_IDENTITY: the service account Pub/Sub delivers as. Only it may call /push. Without it nobody
 *   is asked who they are, which is only for one machine: on Cloud Run the worker refuses to start
 * - CHECK_IDENTITIES: service accounts that may run /selfcheck, comma-separated (the deployer)
 * - TRACING=on: send a trace of each message to Cloud Trace
 * - PAUSED=on: refuse every message, so they wait in the queue
 * - LOCAL_READS=on: serve the counts at /counts, for a web server on the same machine
 * - SERVICE_VERSION: the commit the image was built from (the Dockerfile sets it)
 * - DATA_VERSION_FILE: where the image keeps the hash of the site data, default ./data-version.json
 *   (DATA_VERSION: the hash itself, when there is no such file, as in `npm run dev:server`)
 * - FIRESTORE_HOST: the Firestore API's address, only to point the worker at the emulator
 */
const env = process.env
const project = env.GOOGLE_CLOUD_PROJECT
const version = env.SERVICE_VERSION ?? 'dev'
const log = serviceLog('events-worker', version, project)

if (env.K_SERVICE && !env.PUSH_IDENTITY) {
  // On Cloud Run, starting without a caller check would let any identity that can reach the service add to the counts.
  throw new Error('PUSH_IDENTITY is not set: the worker will not run on Cloud Run without knowing who may deliver messages')
}

const token = googleToken()
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const app = createWorker({
  stats: project && env.STATS_DATABASE ? firestoreStats({ project, database: env.STATS_DATABASE, host: env.FIRESTORE_HOST }, token) : memoryStats(),
  callers: env.PUSH_IDENTITY ? googleCallers({ tokens: googleTokens(googleKeys, Date.now, 'Caller check'), behindCloudRun: Boolean(env.K_SERVICE) }) : null,
  pushIdentity: env.PUSH_IDENTITY ?? null,
  checkIdentities: list(env.CHECK_IDENTITIES),
  traces: project && env.TRACING === 'on' ? cloudTraces(project, token) : null,
  log,
  version,
  dataVersion: readDataVersion(resolve(env.DATA_VERSION_FILE ?? 'data-version.json')) ?? env.DATA_VERSION ?? null,
  revision: env.K_REVISION ?? null,
  paused: env.PAUSED === 'on',
  localReads: env.LOCAL_READS === 'on',
})

const port = Number(env.PORT ?? 8081)
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => log.info(`listening on :${port}`))

/**
 * Cloud Run sends SIGTERM and then waits 10 seconds. Stop taking new messages, finish the ones in
 * hand, then exit. A message cut off here is not lost: the worker never answered, so Pub/Sub
 * delivers it again, and counting it twice is refused.
 */
process.on('SIGTERM', () => {
  log.info('stopping: finishing the messages in hand')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 8000).unref()
})
