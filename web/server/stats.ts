import { reply } from '../shared/http'
import { type DayCounts, dayOf, type StatsReader } from '../shared/stats'

/** How long a copy of the server reuses the counts it read, so the page costs the database a read at most this often. */
const FRESH_MS = 30_000

/**
 * GET /api/stats: today's counts of co-pilot questions (UTC), for the How it works page.
 *
 * The web server only reads them. The events worker is the one writer, and the web server's
 * identity holds a read-only role on the counters database, so nothing here could change a count
 * even by mistake. The count for a day is split across several documents (shards); the reader adds
 * them up (`shared/stats.ts`).
 *
 * 200 with the counts (all zero when nothing has been counted today), 503 when this copy has no
 * counters configured, 502 when they could not be read.
 */
export function statsEndpoint(stats: StatsReader | null | undefined, now: () => number = Date.now): () => Promise<Response> {
  let kept: { at: number; counts: DayCounts } | null = null
  return async () => {
    if (!stats) return reply({ error: 'not-configured' }, 503)
    const day = dayOf(now())
    if (!kept || kept.counts.day !== day || now() - kept.at >= FRESH_MS) {
      try {
        kept = { at: now(), counts: await stats.read(day) }
      } catch (error) {
        console.warn('Counters: could not be read:', error instanceof Error ? error.message : error)
        return reply({ error: 'unavailable' }, 502)
      }
    }
    return reply({ ...kept.counts, asOf: new Date(kept.at).toISOString() })
  }
}
