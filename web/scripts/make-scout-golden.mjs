// Writes copilot/golden/golden.json: questions for Scout with the answers worked out here, straight
// from the pipeline's files in public/data, without any of the co-pilot's code. copilot/golden.test.ts
// checks Scout's tools against it in CI; scripts/scout-eval.mjs asks the live Scout the same questions.
//
//   node scripts/make-scout-golden.mjs            write it
//   node scripts/make-scout-golden.mjs --check    exit 1 if the file differs from what the data gives
//
// Rerun after the data changes on purpose, and read the diff: every changed number is a changed answer.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const OUT = fileURLToPath(new URL('../copilot/golden/golden.json', import.meta.url))
const json = (path) => JSON.parse(readFileSync(DATA + path, 'utf8'))

const month = (site, m) => json(`${site}/${m}/summary.json`)
const year = (site, y) => json(`${site}/heights.json`)[0].years.find((row) => row.year === y)
const hour = (site, iso) => json(`${site}/${iso.slice(0, 7)}/track.json`).find((p) => p.t === iso)

/**
 * The next landing that fits, as the screen offers it: the first hour at or after `fromIso` when a
 * landing meets the limits (brute force over the hourly tracks), moved on inside the same sunlit
 * stretch to the first such hour with margin, where at least half the Sun's disc shows and Earth's
 * center is above the skyline in its own direction. With no such hour in the stretch, the first one stands.
 */
function nextLanding(site, fromIso, { days, sunGap, earthGap }) {
  const skyline = json(`${site}/horizon.json`)
  const skylineAt = (az) => {
    const at = (((az % 360) + 360) % 360) / (360 / skyline.length)
    const i = Math.floor(at)
    return skyline[i % skyline.length].el * (1 - (at - i)) + skyline[(i + 1) % skyline.length].el * (at - i)
  }
  const rows = []
  let d = new Date(fromIso.slice(0, 7) + '-01T00:00:00Z')
  for (let i = 0; i < 4; i++) {
    rows.push(...json(`${site}/${d.toISOString().slice(0, 7)}/track.json`))
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  }
  const longestOff = (from, key) => {
    let best = 0, cur = 0
    for (const p of rows.slice(from, from + days * 24)) { cur = p[key] ? 0 : cur + 1; best = Math.max(best, cur) }
    return best
  }
  const start = rows.findIndex((p) => p.t === fromIso)
  const fits = (t) => rows[t].sun_up && rows[t].earth_up && longestOff(t, 'sun_up') <= sunGap && longestOff(t, 'earth_up') <= earthGap
  for (let t = start; t + days * 24 <= rows.length; t++) {
    if (!fits(t)) continue
    // Within the month the first fit is in, as the screen reads one month's hours for this.
    for (let later = t; later < rows.length && rows[later].sun_up && rows[later].t.slice(0, 7) === rows[t].t.slice(0, 7); later++) {
      if (rows[later].sun_frac >= 0.5 && rows[later].earth_el - skylineAt(rows[later].earth_az) >= 0 && fits(later)) return rows[later].t
    }
    return rows[t].t
  }
  return null
}

/** The month of a year with the most of `key`, and null if two months tie (a tie has no single right answer). */
function bestMonth(site, y, key) {
  const months = json(`${site}/year-${y}.json`).months
  const top = Math.max(...months.map((m) => m[key]))
  const best = months.filter((m) => m[key] === top)
  return best.length === 1 ? { month: best[0].month, value: top } : null
}

const MISSION = { mission_days: 14, max_sun_gap_h: 72, max_earth_gap_h: 72, sun_at_landing: true, earth_at_landing: true, earth_clearance_deg: 0 }
const MISSION_WORDS = 'a 14-day mission with at most 3 days without the Sun or Earth, both up at landing'

const q = []
const add = (id, question, tool, args, expect) => q.push({ id, question, tool, args, expect })

const sr = month('shackleton-rim', '2027-05')
add('G01', 'What share of May 2027 is the Sun up at Shackleton Rim?', 'month_summary', { site: 'shackleton-rim', month: '2027-05' }, { pct_sun: { pct: sr.pct_sun } })
add('G02', 'What share of May 2027 is Earth in view at Shackleton Rim?', 'month_summary', { site: 'shackleton-rim', month: '2027-05' }, { pct_earth: { pct: sr.pct_earth } })
add('G03', 'How much of May 2027 are both the Sun and Earth up at Shackleton Rim?', 'month_summary', { site: 'shackleton-rim', month: '2027-05' }, { pct_both: { pct: sr.pct_both } })
add('G04', 'What is the longest time without the Sun at Shackleton Rim in May 2027?', 'month_summary', { site: 'shackleton-rim', month: '2027-05' }, { longest_without_sun: { hours: sr.max_sun_gap_h } })
add('G05', 'What share of May 2027 is the Sun up at Connecting Ridge?', 'month_summary', { site: 'connecting-ridge', month: '2027-05' }, { pct_sun: { pct: month('connecting-ridge', '2027-05').pct_sun } })
add('G06', 'How much of 2027 is the Sun up at Connecting Ridge?', 'year_summary', { site: 'connecting-ridge', year: 2027 }, { pct_sun: { pct: year('connecting-ridge', 2027).pct_sun } })
add('G07', 'Is Earth always in view from the Apollo 11 site in 2030?', 'year_summary', { site: 'apollo-11', year: 2030 }, { pct_earth: { pct: year('apollo-11', 2030).pct_earth } })
add('G08', "Can you see Earth from the Chang'e 4 site in 2028?", 'year_summary', { site: 'change-4', year: 2028 }, { pct_earth: { pct: year('change-4', 2028).pct_earth } })
for (const [id, site, name, iso, words] of [
  ['G09', 'shackleton-rim', 'Shackleton Rim', '2027-05-14T12:00:00Z', '14 May 2027 at 12:00 UTC'],
  ['G10', 'apollo-11', 'Apollo 11', '2031-09-03T03:00:00Z', '3 September 2031 at 03:00 UTC'],
]) {
  const p = hour(site, iso)
  add(id, `At ${name} on ${words}, is the Sun up and is Earth in view?`, 'conditions_at', { site, time: iso.slice(0, 13) }, { sun: { text: p.sun_up ? 'up' : 'down' }, earth: { text: p.earth_up ? 'in view' : 'out of view' } })
}
add('G11', 'What share of January 2028 is the Sun up at de Gerlache Rim?', 'month_summary', { site: 'de-gerlache-rim', month: '2028-01' }, { pct_sun: { pct: month('de-gerlache-rim', '2028-01').pct_sun } })
add('G12', 'What is the longest time without Earth at Peak near Shackleton in March 2029?', 'month_summary', { site: 'peak-near-shackleton', month: '2029-03' }, { longest_without_earth: { hours: month('peak-near-shackleton', '2029-03').max_earth_gap_h } })
const limits = { days: 14, sunGap: 72, earthGap: 72 }
add('G13', `My landing at Shackleton Rim was planned for 1 May 2027 00:00 UTC. When is the next landing that fits ${MISSION_WORDS}?`, 'next_landing', { site: 'shackleton-rim', time: '2027-05-01T00', ...MISSION }, { next_landing: { time: nextLanding('shackleton-rim', '2027-05-01T00:00:00Z', limits) } })
add('G14', `My Connecting Ridge landing slipped to 14 June 2027 00:00 UTC. What is the next hour that fits ${MISSION_WORDS}?`, 'next_landing', { site: 'connecting-ridge', time: '2027-06-14T00', ...MISSION }, { next_landing: { time: nextLanding('connecting-ridge', '2027-06-14T00:00:00Z', limits) } })
const cr = month('connecting-ridge', '2027-05')
add('G15', 'Compare Shackleton Rim and Connecting Ridge for sunlight in May 2027.', 'compare_sites', { site_a: 'shackleton-rim', site_b: 'connecting-ridge', month: '2027-05' }, { sun_up_a: { pct: sr.pct_sun }, sun_up_b: { pct: cr.pct_sun } })
// "Most sunlight" ties at 100% in several months of 2027 at Shackleton Rim, so it has no single right
// answer; "both Sun and Earth up" does not tie.
const best = bestMonth('shackleton-rim', 2027, 'pct_both')
if (!best) throw new Error('G16: the best month for both up ties; pick another site or year')
const bestName = new Date(best.month + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
add('G16', 'Which month of 2027 has the Sun and Earth both up the most at Shackleton Rim?', 'best_months', { site: 'shackleton-rim', measure: 'both', year: 2027, count: 1 }, { best_1_month: { text: bestName }, best_1_value: { pct: best.value, places: 0 } })
add('G17', "How much of 2027 is Earth in view at IM-2 Athena's site?", 'year_summary', { site: 'im-2-athena', year: 2027 }, { pct_earth: { pct: year('im-2-athena', 2027).pct_earth } })
add('G18', "What share of July 2027 is the Sun up at Blue Ghost 1's site?", 'month_summary', { site: 'blue-ghost-1', month: '2027-07' }, { pct_sun: { pct: month('blue-ghost-1', '2027-07').pct_sun } })
const srSite = json('sites.json').find((s) => s.id === 'shackleton-rim')
add('G19', 'Where exactly is Shackleton Rim? Give its latitude.', 'site_info', { site: 'shackleton-rim' }, { latitude: { latitude: srSite.lat } })
const range = json('range.json')
add('G20', 'Which years does your data cover?', 'site_info', { site: 'shackleton-rim' }, { data_from: { text: `January ${range.first_year}` }, data_to: { text: `December ${range.last_year}` } })
add('G21', 'What share of May 2060 is the Sun up at Shackleton Rim?', 'month_summary', { site: 'shackleton-rim', month: '2060-05' }, { error: { contains: String(range.last_year) } })
add('G22', 'How much sunlight does Mars Base Alpha get in May 2027?', 'month_summary', { site: 'mars-base-alpha', month: '2027-05' }, { error: { contains: 'Unknown site' } })
add('G23', 'What share of August 2027 is the Sun up at the Chandrayaan-3 site?', 'month_summary', { site: 'chandrayaan-3', month: '2027-08' }, { pct_sun: { pct: month('chandrayaan-3', '2027-08').pct_sun } })
add('G24', 'What is the longest time without the Sun at the SLIM site in February 2027?', 'month_summary', { site: 'slim', month: '2027-02' }, { longest_without_sun: { hours: month('slim', '2027-02').max_sun_gap_h } })
add('G25', 'How much of 2027 is the Sun up at Apollo 15?', 'year_summary', { site: 'apollo-15', year: 2027 }, { pct_sun: { pct: year('apollo-15', 2027).pct_sun } })

const text = JSON.stringify(
  {
    about:
      "Golden questions for Scout. Each expected value was worked out by scripts/make-scout-golden.mjs straight from public/data, not by the co-pilot's code. copilot/golden.test.ts runs each question's tool and checks the facts against these values; scripts/scout-eval.mjs asks the live Scout the questions. Regenerate after the data changes on purpose, and review the diff.",
    questions: q,
  },
  null,
  1,
) + '\n'

if (process.argv.includes('--check')) {
  const now = readFileSync(OUT, 'utf8')
  if (now !== text) {
    console.error('copilot/golden/golden.json differs from what the data gives. Run: node scripts/make-scout-golden.mjs, and review the diff.')
    process.exit(1)
  }
  console.log(`golden.json is up to date (${q.length} questions)`)
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${q.length} questions to copilot/golden/golden.json`)
}
