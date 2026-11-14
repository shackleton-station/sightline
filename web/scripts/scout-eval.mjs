// Asks the live Scout the golden questions (copilot/golden/golden.json) and checks that each answer
// quotes the values worked out from the data. Run by hand, never in CI: every question is a paid model
// call and counts against the site's shared allowance (about 25 questions: about $2.50, and 2.5% of a
// day's 1,000). Never run it as a load test.
//
//   node scripts/scout-eval.mjs [baseUrl]        default https://lunarsightline.com
//
// Exits 1 if any answer misses its values.
import { readFileSync } from 'node:fs'

const BASE = (process.argv[2] ?? 'https://lunarsightline.com').replace(/\/$/, '')
const PAUSE_MS = 6000 // at most 10 a minute, under the per-visitor 15
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const golden = JSON.parse(readFileSync(new URL('../copilot/golden/golden.json', import.meta.url), 'utf8'))

/** The ways an answer may write each expected value, as the tools format them (shared/tools/facts.ts). */
function forms(want) {
  if ('pct' in want) return want.places === 0 ? [`${Math.round(want.pct)}%`] : [`${want.pct.toFixed(1)}%`, ...(Number.isInteger(want.pct) ? [`${want.pct}%`] : [])]
  if ('hours' in want) {
    const d = Math.floor(want.hours / 24), h = want.hours % 24
    return [`${want.hours} h`, d > 0 ? (h > 0 ? `${d} d ${h} h` : `${d} d`) : `${h} h`]
  }
  if ('time' in want) {
    const t = new Date(want.time)
    const hh = String(t.getUTCHours()).padStart(2, '0'), mm = String(t.getUTCMinutes()).padStart(2, '0')
    return [`${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${hh}:${mm} UTC`]
  }
  if ('latitude' in want) return [`${Math.abs(want.latitude).toFixed(3)}°${want.latitude < 0 ? 'S' : 'N'}`]
  if ('text' in want) return [want.text]
  return []
}

let failed = 0
for (const q of golden.questions) {
  const started = performance.now()
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json', 'user-agent': 'sightline-scout-eval/1' },
    body: JSON.stringify({ messages: [{ role: 'user', text: q.question }] }),
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const body = await response.json().catch(() => ({}))
  const text = body.reply?.text ?? ''
  let ok = response.status === 200
  const notes = []
  for (const [key, want] of Object.entries(q.expect)) {
    if ('contains' in want) {
      // A question the data cannot answer: no made-up share in the reply.
      if (/\d+(?:\.\d+)?\s*%/.test(text)) { ok = false; notes.push('quoted a share for a question the data cannot answer') }
      continue
    }
    // conditions_at's up/down words are phrased freely in an answer; only numbers and names are matched.
    if (key === 'sun' || key === 'earth') continue
    const options = forms(want)
    if (!options.some((form) => text.includes(form))) { ok = false; notes.push(`${key}: expected ${options.join(' or ')}`) }
  }
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${q.id} ${response.status} ${seconds}s  ${notes.join('; ')}\n      ${text.slice(0, 160)}`)
  if (response.status === 429 || response.status === 503) {
    const wait = Number(response.headers.get('retry-after') ?? 15)
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 90) * 1000))
  }
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
}
console.log(`\n${golden.questions.length - failed} of ${golden.questions.length} answers quote the expected values`)
process.exit(failed ? 1 : 0)
