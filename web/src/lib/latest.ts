/** What `latestOnly` needs from a clock; tests pass their own. */
export interface Clock {
  now(): number
  later(run: () => void, ms: number): unknown
}

const realClock: Clock = { now: () => Date.now(), later: (run, ms) => setTimeout(run, ms) }

/**
 * Sends a value that changes often, at most once every `everyMs`, and always the newest: the first
 * change goes at once, changes that arrive while waiting replace one another, and the last one is
 * sent when its turn comes (so what was sent last is where things came to rest). Only one send runs
 * at a time. A send that fails (`false`) is tried again after `retryMs`, unless something newer has
 * replaced it by then.
 */
export function latestOnly<T>(send: (value: T) => Promise<boolean>, everyMs: number, retryMs: number, clock: Clock = realClock): (value: T) => void {
  let waiting: { value: T } | null = null
  let scheduled = false
  let sending = false
  let nextAt = Number.NEGATIVE_INFINITY

  const schedule = () => {
    if (scheduled || sending || !waiting) return
    scheduled = true
    const wait = nextAt - clock.now()
    // With nothing to wait for, the send starts here and now, ahead of whatever the caller does next.
    if (wait <= 0) void run()
    else clock.later(run, wait)
  }
  const run = async () => {
    scheduled = false
    if (!waiting) return
    const { value } = waiting
    waiting = null
    sending = true
    nextAt = clock.now() + everyMs
    const sent = await send(value).catch(() => false)
    sending = false
    if (!sent) {
      waiting ??= { value }
      nextAt = clock.now() + retryMs
    }
    schedule()
  }

  return (value) => {
    waiting = { value }
    schedule()
  }
}
