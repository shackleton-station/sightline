import type { Locks } from './store'

/**
 * One recompute per key ("single flight").
 *
 * THE PROBLEM. A cached answer is missing: it expired, or a deploy started an empty cache. A room
 * of people taps the same suggested question within a second. Each request misses, and each pays
 * for the same model call. Thirty people, thirty calls, one answer.
 *
 * THE PATTERN. The first request to miss takes a short lock in Redis and works the answer out. The
 * others see the lock is held and wait briefly for the answer to appear in the cache, asking again
 * after growing pauses. If it does not come, each works it out itself: waiting never turns into
 * failing. The lock is in Redis, so it is one lock for every copy of every service that can answer.
 *
 *   request 1  miss ─ lock taken ─ look again ─ work it out ─ keep it ─ release
 *   request 2  miss ─ lock held ── wait 0.1 s, 0.15 s, 0.23 s … 0.5 s ── the kept answer
 *
 * THE LOCK. `SET key token NX PX 15000`: written only if nobody holds it, and gone by itself after
 * 15 s if its holder stops. The token is unique to the holder, and the release deletes the key only
 * if it still holds that token (a script, `DELETE_IF_SCRIPT`), so a holder that overran its 15 s
 * cannot delete the lock someone else has taken since.
 *
 * WHAT A WAITER DOES. Each time it wakes it reads the cache, from the primary (a replica may not
 * have the answer yet). If the answer is there, it is done. If not, it asks for the lock: when the
 * holder has stopped, or finished with nothing worth keeping, the lock is free and this waiter
 * takes over. Otherwise it waits again. It stops waiting after `maxWaitMs`, or sooner if less than
 * `reserveMs` would be left before the request's own deadline, and then works the answer out with
 * what is left.
 *
 * WHAT IT COSTS A REQUEST THAT IS ALONE. Three small calls to Redis around a model call that takes
 * seconds: take the lock, look again, release. No waiting.
 *
 * WITHOUT REDIS there are no locks (`locks` undefined), or the lock cannot be asked for (it
 * rejects): the request works the answer out at once, as it always did.
 */
export interface FlightSettings {
  /** How long the lock lasts if its holder never releases it. */
  lockMs: number
  /** The longest a request waits for someone else's answer. */
  maxWaitMs: number
  /** A request stops waiting when less than this is left before its own deadline, so it can still work the answer out. */
  reserveMs: number
  /** The first pause between looks, how fast the pauses grow, and their ceiling. */
  firstPollMs: number
  pollGrowth: number
  maxPollMs: number
}

/**
 * The numbers, and what they rest on (docs/decisions/0006-redis-replica-and-cluster.md). Uncached
 * co-pilot answers took a median of 4.7 s and a 95th percentile of 10.7 s on the baseline day.
 * - The lock lasts 15 s: longer than nearly every answer takes, so it rarely expires under a holder
 *   that is still working, and short enough that a holder that stopped is replaced soon.
 * - A waiter waits at most 10 s, and keeps 12 s of its 25 s to work the answer out itself.
 * - Pauses of 100 ms, growing by half each time to 0.5 s: about 22 looks in 10 s, each one or two
 *   small calls to Redis. A waiter gets the answer at most half a second after it is kept. The
 *   ceiling was 1 s at first; on a laptop with 24 requests at once the waiters then got their
 *   answer up to a second after the leader had it, for the sake of a few reads.
 */
export const FLIGHT: FlightSettings = { lockMs: 15_000, maxWaitMs: 10_000, reserveMs: 12_000, firstPollMs: 100, pollGrowth: 1.5, maxPollMs: 500 }

/**
 * How the request got its result:
 * - `alone`: there are no locks here; it worked the answer out.
 * - `no-lock`: the lock could not be asked for (Redis is away); it worked the answer out.
 * - `led`: it took the lock and worked the answer out.
 * - `found`: it took the lock, looked again, and the answer was already kept.
 * - `waited`: someone else held the lock, and their answer arrived.
 * - `took-over`: it waited, the lock came free with no answer kept, and it worked the answer out.
 * - `gave-up`: it waited as long as it may, and worked the answer out without the lock.
 * `tookMs` is the whole of it, waiting and working, on the request's clock.
 */
export type Flight<T> = { how: 'alone' | 'no-lock' | 'led' | 'took-over' | 'gave-up'; value: T; tookMs: number } | { how: 'found' | 'waited'; kept: string; tookMs: number }

export interface FlightOptions<T> {
  /** Names the work: requests with the same key share one flight. */
  key: string
  /** Locks every copy sees; undefined where there are none. */
  locks: Locks | undefined
  /** Reads the kept result as the primary has it now, or null. */
  read: () => Promise<string | null>
  /** Works the result out, and keeps it before it returns if it is worth keeping. `waitedMs` is how long this request waited first. */
  compute: (waitedMs: number) => Promise<T>
  /** When the request's own time is up, in ms since the epoch. */
  deadline: number
  now?: () => number
  /** Pauses for that long. Tests pass a fake clock. */
  wait?: (ms: number) => Promise<void>
  /** A number in [0, 1), to spread the pauses so waiters do not all look at the same instant. */
  random?: () => number
  settings?: FlightSettings
  /** Told once, when this request starts waiting for someone else's answer. */
  onWait?: () => void
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

export async function singleFlight<T>(options: FlightOptions<T>): Promise<Flight<T>> {
  const { key, locks, read, compute } = options
  const now = options.now ?? Date.now
  const wait = options.wait ?? sleep
  const random = options.random ?? Math.random
  const settings = options.settings ?? FLIGHT
  const started = now()
  const waited = () => now() - started

  if (!locks) return { how: 'alone', value: await compute(0), tookMs: 0 }

  /** Holding the lock: look once more, work it out if it is still missing, and release. */
  const lead = async (token: string, how: 'led' | 'took-over'): Promise<Flight<T>> => {
    try {
      // The answer may have been kept between this request's miss and its lock, or the replica it read was behind.
      const kept = await read().catch(() => null)
      if (kept !== null) return { how: 'found', kept, tookMs: waited() }
      return { how, value: await compute(waited()), tookMs: waited() }
    } finally {
      await locks.release(key, token)
    }
  }

  let token: string | null
  try {
    token = await locks.acquire(key, settings.lockMs)
  } catch {
    return { how: 'no-lock', value: await compute(0), tookMs: 0 }
  }
  if (token !== null) return lead(token, 'led')

  // Someone else is working it out. Wait for their answer, in growing pauses.
  options.onWait?.()
  const until = Math.min(started + settings.maxWaitMs, options.deadline - settings.reserveMs)
  let pause = settings.firstPollMs
  while (now() + pause <= until) {
    // Between 80% and 120% of the pause, so a room of waiters does not look at the same instant.
    await wait(Math.round(pause * (0.8 + 0.4 * random())))
    try {
      const kept = await read()
      if (kept !== null) return { how: 'waited', kept, tookMs: waited() }
      token = await locks.acquire(key, settings.lockMs)
    } catch {
      // Redis went away while waiting: stop waiting.
      return { how: 'no-lock', value: await compute(waited()), tookMs: waited() }
    }
    if (token !== null) return lead(token, 'took-over')
    pause = Math.min(settings.maxPollMs, pause * settings.pollGrowth)
  }
  return { how: 'gave-up', value: await compute(waited()), tookMs: waited() }
}
