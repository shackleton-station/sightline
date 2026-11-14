import { randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Callers } from '../shared/caller'
import { briefly, readEvent, readPush, TRACE_ATTRIBUTE } from '../shared/events'
import { reply } from '../shared/http'
import type { Log } from '../shared/log'
import { countsOf, dayOf, SHARDS, type StatsStore } from '../shared/stats'
import { startTrace, traceContext, traceparentContext, type TraceSink } from '../shared/trace'

/** What the worker needs from outside itself. Tests pass fakes; `index.ts` passes the real ones. */
export interface WorkerDeps {
  /** Where the counts are kept: Firestore in production, this process's memory otherwise. */
  stats: StatsStore
  /** Tells who is calling. Null only when everything runs on one machine: then nobody is asked. */
  callers: Callers | null
  /** The one identity that may deliver messages: the push subscription's service account. */
  pushIdentity: string | null
  /** Identities that may run the self-check (the deployer). */
  checkIdentities: string[]
  traces?: TraceSink | null
  log: Log
  /** The commit this image was built from. */
  version: string
  /** A hash of the site data in that commit (see `scripts/data-version.mjs`). */
  dataVersion: string | null
  /** Cloud Run's name for this deploy. */
  revision: string | null
  /** Refuses every message, so they wait in the queue. For stopping the worker without undeploying it. */
  paused?: boolean
  /** Serves the counts over HTTP. Only for one machine, where the web server has no shared database to read. */
  localReads?: boolean
  now?: () => number
}

const NAME = 'events-worker'
/** An event is a few hundred bytes. Anything this big is not one of ours. */
const MAX_BODY_CHARS = 100_000

/**
 * The events worker: one endpoint that Pub/Sub pushes each event to, and a status address.
 * No visitor ever calls it, and it has no public access: Cloud Run lets in only identities with
 * permission, and each endpoint then checks which identity it is.
 *
 * What the answer to a push means to Pub/Sub: 2xx is "done, do not send it again"; anything else is
 * "send it again later". So a duplicate is answered 204 (it is done), and a failure to write is
 * answered 503 (try again). A message that can never be counted is answered 400 every time: Pub/Sub
 * gives up after five tries and moves it to the dead-letter topic, where a person can look at it.
 */
export function createWorker(deps: WorkerDeps): Hono {
  const now = deps.now ?? Date.now
  const { log, stats } = deps

  /** Whether the caller is one of `allowed`. With no caller check configured, everyone is. */
  async function calledBy(request: Request, allowed: string[]): Promise<Response | null> {
    if (!deps.callers) return null
    const caller = await deps.callers.identify(request.headers.get('authorization'))
    if (!caller.ok) return reply({ error: caller.why === 'missing' ? 'no-token' : 'bad-token' }, 401)
    if (!allowed.includes(caller.email)) return reply({ error: 'wrong-caller' }, 403)
    return null
  }

  async function handlePush(request: Request): Promise<Response> {
    if (deps.paused) {
      log.warn('paused: message refused, the queue will send it again')
      return reply({ error: 'paused' }, 503)
    }
    const refused = await calledBy(request, deps.pushIdentity ? [deps.pushIdentity] : [])
    if (refused) {
      log.warn('push refused', { status: refused.status })
      return refused
    }

    const text = await request.text()
    const pushed = text.length <= MAX_BODY_CHARS ? readPush(text) : null
    if (!pushed) {
      log.warn('push is not a Pub/Sub message', { chars: text.length })
      return reply({ error: 'malformed' }, 400)
    }
    const about = { messageId: pushed.messageId, attempt: pushed.deliveryAttempt }
    const read = readEvent(pushed.data, pushed.messageId)
    if (read.is === 'malformed') {
      // Not the event's contents, which could hold a visitor's words: only what was wrong with it.
      log.warn('event cannot be counted', { ...about, why: read.why })
      return reply({ error: 'malformed' }, 400)
    }
    if (read.is === 'other') {
      // Another kind of event on the same topic is not an error. Acknowledge it and move on.
      log.info('event of another kind, not counted', { ...about, kind: read.kind })
      return new Response(null, { status: 204 })
    }

    const { key, day, cached, outcome } = read.question
    // The publisher put its trace in the message, so this step shows under the visitor's own request.
    const context = traceparentContext(pushed.attributes[TRACE_ATTRIBUTE]) ?? traceContext(null)
    return startTrace(
      `${NAME}: count a question`,
      context,
      deps.traces,
      async (finish) => {
        try {
          const result = await stats.count({ key, day, add: countsOf({ cached, outcome }) })
          log.info(result === 'counted' ? 'question counted' : 'question already counted', { ...about, result, day, outcome, cached })
          await briefly(finish({ result, day }))
          return new Response(null, { status: 204 })
        } catch (error) {
          log.error('could not count a question', { ...about, day, error: error instanceof Error ? error.message : String(error) })
          await briefly(finish({ result: 'failed' }))
          return reply({ error: 'store' }, 503)
        }
      },
      now,
    )
  }

  /**
   * Proves the real write path on the real database, with no real event: counts one made-up event
   * twice on a scratch day and checks it was added once and refused once. The deploy runs it against
   * a new version before any message reaches it. The scratch documents expire a day later.
   */
  async function selfCheck(request: Request): Promise<Response> {
    const refused = await calledBy(request, deps.checkIdentities)
    if (refused) return refused
    const day = `selfcheck-${randomBytes(4).toString('hex')}`
    const event = { key: `check-${randomUUID()}`, day, add: countsOf({ cached: false, outcome: 'answered' }) }
    const keep = { seenDays: 1, countDays: 1 }
    try {
      const first = await stats.count(event, keep)
      const second = await stats.count(event, keep)
      const { counts } = await stats.read(day)
      const ok = first === 'counted' && second === 'duplicate' && counts.questions === 1
      log.info('self-check', { ok, first, second, questions: counts.questions })
      return reply({ ok, first, second, questions: counts.questions }, ok ? 200 : 500)
    } catch (error) {
      log.error('self-check failed', { error: error instanceof Error ? error.message : String(error) })
      return reply({ ok: false, error: 'store' }, 500)
    }
  }

  const app = new Hono()
  app.post('/push', (c) => handlePush(c.req.raw))
  app.all('/push', () => reply({ error: 'method' }, 405))
  app.post('/selfcheck', (c) => selfCheck(c.req.raw))
  // What this copy is running. No secrets. Cloud Run has already checked the caller may call the service.
  app.get('/status', () =>
    reply({ service: NAME, version: deps.version, revision: deps.revision, dataVersion: deps.dataVersion, store: stats.kind, shards: SHARDS, callerCheck: deps.callers ? 'on' : 'off', paused: Boolean(deps.paused) }),
  )
  if (deps.localReads) {
    app.get('/counts', async (c) => {
      const day = c.req.query('day') ?? dayOf(now())
      return /^\d{4}-\d{2}-\d{2}$/.test(day) ? reply(await stats.read(day)) : reply({ error: 'bad-day' }, 400)
    })
  }
  app.all('*', () => reply({ error: 'not-found' }, 404))
  app.onError((error) => {
    log.error('request failed', { error: error instanceof Error ? error.message : String(error) })
    return reply({ error: 'server' }, 500)
  })
  return app
}
