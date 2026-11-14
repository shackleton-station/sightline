/**
 * Allows `limit` calls per `windowMs` for each key, counted in this process's memory. Each Cloud Run
 * instance keeps its own count, so with N instances the real ceiling is up to N times the limit.
 */
export class RateLimit {
  private readonly hits = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** True if this call is allowed; it then counts against the key. */
  take(key: string): boolean {
    return this.attempt(key).allowed
  }

  /**
   * The same, and after a refusal how long until this key may call again: until the oldest call
   * in the window leaves it. That is what a `Retry-After` header tells the visitor.
   */
  attempt(key: string): { allowed: boolean; retryAfterMs: number } {
    return this.ask(key, true)
  }

  /** What `attempt` would answer, without counting the call: a look, so a call another limit refuses is counted nowhere. */
  peek(key: string): { allowed: boolean; retryAfterMs: number } {
    return this.ask(key, false)
  }

  private ask(key: string, count: boolean): { allowed: boolean; retryAfterMs: number } {
    const now = this.now()
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return { allowed: false, retryAfterMs: Math.max(1, recent[recent.length - this.limit] + this.windowMs - now) }
    }
    if (!count) return { allowed: true, retryAfterMs: 0 }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) this.forgetIdle(now)
    return { allowed: true, retryAfterMs: 0 }
  }

  private forgetIdle(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key)
    }
  }
}
