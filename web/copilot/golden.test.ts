import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteData } from '../shared/tools/data'
import { DEFAULT_LIMITS } from '../shared/tools/defaults'
import { runTool } from '../shared/tools/tools'

/**
 * Scout's golden questions (golden/golden.json). Each names the tool that answers it and the facts
 * the answer must quote; the expected values were worked out straight from public/data by
 * scripts/make-scout-golden.mjs, without the co-pilot's code. Every number in Scout's answers is one
 * of these facts (chat/render.ts), so a tool that drifts from the data fails here, in CI, before any
 * visitor reads it. Whether the model picks the right tool is checked live by scripts/scout-eval.mjs.
 */

type Expect =
  | { pct: number; places?: number }
  | { hours: number }
  | { time: string }
  | { text: string }
  | { latitude: number }
  | { contains: string }

interface Golden {
  id: string
  question: string
  tool: string
  args: Record<string, unknown>
  expect: Record<string, Expect>
}

const golden: { questions: Golden[] } = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'))
const data = siteData(fileURLToPath(new URL('../public/data', import.meta.url)))
const context = { data, requirements: DEFAULT_LIMITS }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "5 d 23 h", "143 h", "12 d" or "0 h", in hours. */
export function hoursOf(value: string): number {
  const match = /^(?:(\d+) d)?\s*(?:(\d+) h)?$/.exec(value.trim())
  if (!match || (match[1] === undefined && match[2] === undefined)) throw new Error(`not a duration: ${value}`)
  return Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)
}

/** "26 May 2027, 17:00 UTC" as an ISO time. */
export function timeOf(value: string): string {
  const match = /^(\d{1,2}) ([A-Za-z]+) (\d{4}), (\d{2}):(\d{2}) UTC$/.exec(value.trim())
  if (!match || !MONTHS.includes(match[2])) throw new Error(`not a time: ${value}`)
  return new Date(Date.UTC(Number(match[3]), MONTHS.indexOf(match[2]), Number(match[1]), Number(match[4]), Number(match[5]))).toISOString().replace('.000Z', 'Z')
}

/** "89.762°S" as signed degrees. */
export function latitudeOf(value: string): number {
  const match = /^([\d.]+)°([NS])$/.exec(value.trim())
  if (!match) throw new Error(`not a latitude: ${value}`)
  return Number(match[1]) * (match[2] === 'S' ? -1 : 1)
}

describe('golden questions', () => {
  it('has the questions it should', () => {
    expect(golden.questions.length).toBeGreaterThanOrEqual(20)
    expect(new Set(golden.questions.map((q) => q.id)).size).toBe(golden.questions.length)
  })

  it.each(golden.questions.map((q) => [q.id, q] as const))('%s: the tool gives the answer worked out from the data', async (_, q) => {
    const result = await runTool(q.tool, q.args, context)
    if ('error' in q.expect) {
      expect(result.ok, q.question).toBe(false)
      expect(result.ok ? '' : result.error).toContain((q.expect.error as { contains: string }).contains)
      return
    }
    if (!result.ok) throw new Error(`${q.id}: ${result.error}`)
    for (const [key, want] of Object.entries(q.expect)) {
      const fact = result.facts.find((item) => item.key === key)
      expect(fact, `${q.id}: no fact "${key}"`).toBeDefined()
      const value = fact?.value ?? ''
      // A tool that shows whole percents (best_months, best_sites) is held to the rounded value.
      if ('pct' in want) expect(Number.parseFloat(value), `${q.id} ${key} = ${value}`).toBeCloseTo(want.places === 0 ? Math.round(want.pct) : want.pct, 1)
      else if ('hours' in want) expect(hoursOf(value), `${q.id} ${key} = ${value}`).toBe(want.hours)
      else if ('time' in want) expect(timeOf(value), `${q.id} ${key} = ${value}`).toBe(want.time)
      else if ('latitude' in want) expect(latitudeOf(value), `${q.id} ${key} = ${value}`).toBeCloseTo(want.latitude, 3)
      else if ('text' in want) expect(value, `${q.id} ${key}`).toBe(want.text)
      else throw new Error(`${q.id}: unknown expectation for ${key}`)
    }
  })
})

describe('reading the facts', () => {
  it.each([
    ['5 d 23 h', 143],
    ['143 h', 143],
    ['12 d', 288],
    ['0 h', 0],
  ])('%s is %d hours', (text, hours) => expect(hoursOf(text)).toBe(hours))

  it('reads a time and a latitude', () => {
    expect(timeOf('26 May 2027, 17:00 UTC')).toBe('2027-05-26T17:00:00Z')
    expect(latitudeOf('89.762°S')).toBeCloseTo(-89.762, 3)
  })
})
