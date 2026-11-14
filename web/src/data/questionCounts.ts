import { useEffect, useState } from 'react'

/** Today's counts of co-pilot questions, as `GET /api/stats` answers them. Counts only: no question is ever in here. */
export interface QuestionCounts {
  /** The day they are for, `YYYY-MM-DD`, in UTC. */
  day: string
  questions: number
  /** Answered from the answer cache. */
  cached: number
  /** Written from the looked-up facts, after the model failed to write the answer. */
  fallback: number
  /** Turned away because the model was busy. */
  busy: number
  failed: number
}

/** `unavailable` covers every way of not having them: not switched on, the read failed, or the server is older than this page. */
export type CountsState = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; counts: QuestionCounts }

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null)

/** The counts from the server's reply, or null if it isn't shaped as expected. Fields the page doesn't know are ignored. */
export function readCounts(body: unknown): QuestionCounts | null {
  if (typeof body !== 'object' || body === null) return null
  const { day, counts } = body as { day?: unknown; counts?: unknown }
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof counts !== 'object' || counts === null) return null
  const { questions, cached, fallback, busy, failed } = counts as Record<string, unknown>
  const read = { questions: count(questions), cached: count(cached), fallback: count(fallback), busy: count(busy), failed: count(failed) }
  if (read.questions === null || read.cached === null || read.fallback === null || read.busy === null || read.failed === null) return null
  return { day, questions: read.questions, cached: read.cached, fallback: read.fallback, busy: read.busy, failed: read.failed }
}

/** A share as a whole percentage, for "N of M (P%)". Null when there is nothing to take a share of. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((100 * part) / whole) : null
}

/** Today's counts, read once when the page opens. */
export function useQuestionCounts(): CountsState {
  const [state, setState] = useState<CountsState>({ state: 'loading' })
  useEffect(() => {
    let current = true
    fetch(`${import.meta.env.BASE_URL}api/stats`)
      .then(async (response) => (response.ok ? readCounts(await response.json()) : null))
      .catch(() => null)
      .then((counts) => {
        if (current) setState(counts ? { state: 'ready', counts } : { state: 'unavailable' })
      })
    return () => {
      current = false
    }
  }, [])
  return state
}
