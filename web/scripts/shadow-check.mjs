// Measures how well the 3D terrain view's sunlight and shadow match the LOLA terrain (docs/VALIDATION.md §8).
//
// Run it from web/, after `npm install`:
//
//   node scripts/shadow-check.mjs                 the view as drawn on a large screen
//   node scripts/shadow-check.mjs --small         the small-screen setting (coarser terrain and shadow maps)
//   node scripts/shadow-check.mjs --sites=apollo-11,slim --out=points.json
//
// It starts the Vite dev server, opens scripts/shadow-check.html in headless Chrome, waits for the page
// (src/dev/shadowCheck.ts) to send back every point it tested, and prints the tables. It takes under a
// minute with local tiles. --out saves every point, for a closer look.
//
// Needs Google Chrome (set CHROME to its path if it isn't in the usual place) and the terrain tiles:
// web/public/tiles if you have built them, otherwise the dev server fetches them from the live site.
// The result depends on the graphics card, so the output names the one Chrome used. On macOS Chrome is
// asked for Metal; elsewhere, check that line doesn't say SwiftShader (software drawing).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const TIMEOUT_MS = 20 * 60_000
/** An hour can tell a right Sun from a wrong one only if it has this many points of each kind. */
const MIXED_MIN = 20
/**
 * A pixel has some sunlight when it is brighter than the same pixel drawn with no sunlight by more
 * than this (red + green + blue, each 0 to 255; the margin is for rounding). It compares each pixel
 * with itself, so it doesn't depend on how bright lit ground is or on the blue tint.
 */
const SOME_LIGHT_STEPS = 6
/** Shadowed points are grouped by how far away the terrain that hides the Sun is (m). */
const BLOCKER_BANDS_M = [0, 1_000, 3_000, 8_000, Number.POSITIVE_INFINITY]
// Each point is drawn with three Suns, in this order.
const ACTUAL = 0
const TURNED_90 = 1
const FLIPPED_180 = 2

// The page copies the terrain levels from the app. Stop if the two have drifted apart.
const levelsIn = (file) =>
  /const LEVELS: MeshLevel\[\] = \[.*?\]\nconst LEVELS_SMALL: MeshLevel\[\] = \[.*?\]\n/s.exec(readFileSync(join(webDir, file), 'utf8'))?.[0]
if (!levelsIn('src/dev/shadowCheck.ts') || levelsIn('src/dev/shadowCheck.ts') !== levelsIn('src/components/MoonView3D.tsx')) {
  console.error('LEVELS in src/dev/shadowCheck.ts no longer match src/components/MoonView3D.tsx. Copy them across.')
  process.exit(1)
}

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) =>
    existsSync(path),
  )
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}

/** Resolves with what the page sends to /__shadow-check/result. */
let finish
let fail
const result = new Promise((resolve, reject) => {
  finish = resolve
  fail = reject
})
const collector = {
  name: 'shadow-check-collector',
  configureServer(server) {
    server.middlewares.use('/__shadow-check', (request, response) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (request.url === '/log') console.error(`  ${body}`)
        if (request.url === '/error') fail(new Error(`The page failed: ${body}`))
        if (request.url === '/result') finish(body)
        response.end('ok')
      })
    })
  },
}

const server = await createServer({ root: webDir, logLevel: 'warn', plugins: [collector] })
await server.listen()
const query = new URLSearchParams({ small: args.has('small') ? '1' : '0', ...(args.has('sites') ? { sites: args.get('sites') } : {}) })
const pageUrl = `${server.resolvedUrls.local[0]}scripts/shadow-check.html?${query}`
const profile = mkdtempSync(join(tmpdir(), 'shadow-check-'))
const browser = spawn(
  chrome,
  [
    '--headless=new',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    '--force-device-scale-factor=1',
    '--window-size=1700,1800',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    pageUrl,
  ],
  { stdio: 'ignore' },
)
const timer = setTimeout(() => fail(new Error('Timed out waiting for the page.')), TIMEOUT_MS)

let run
try {
  run = await result
} finally {
  clearTimeout(timer)
  browser.kill()
  await server.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
if (args.has('out')) writeFileSync(args.get('out'), JSON.stringify(run))

// ---- Reading the pixels ----

const sum = (values) => values.reduce((total, value) => total + value, 0)
/** A 0 to 255 screen value as an amount of light. */
const light = (value) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
/** How much brighter a point is drawn than its unlit color, in screen steps. */
const stepsGained = (point, sun) => sum(point.drawn[sun]) - sum(point.unlit)
/** The same as an amount of light, averaged over red, green and blue. */
const lightGained = (point, sun) => sum(point.drawn[sun].map((value, i) => light(value) - light(point.unlit[i]))) / 3

const all = run.hours.flatMap((hour) => hour.points)

// Full sunlight on a slope is proportional to how squarely the slope faces the Sun. The factor is read
// from the picture: the middle value over all points that gained any light, most of which are in full Sun.
const perFacing = all
  .filter((point) => point.facing[ACTUAL] > 0.02 && stepsGained(point, ACTUAL) > SOME_LIGHT_STEPS)
  .map((point) => lightGained(point, ACTUAL) / point.facing[ACTUAL])
  .sort((a, b) => a - b)
const fullSunPerFacing = perFacing[Math.floor(perFacing.length / 2)]

/** Two readings of "drawn lit": more than half of full sunlight (the main one), or any sunlight at all. */
const RULES = {
  half: (point, sun) =>
    stepsGained(point, sun) > SOME_LIGHT_STEPS && lightGained(point, sun) > 0.5 * fullSunPerFacing * point.facing[sun],
  some: (point, sun) => stepsGained(point, sun) > SOME_LIGHT_STEPS,
}

/** Compare the drawing (with the real Sun, or a wrong one) against the terrain's answer for the real Sun. */
function compare(points, rule, sun = ACTUAL) {
  const tally = { n: points.length, agree: 0, litButShadowed: 0, darkButLit: 0 }
  for (const point of points) {
    const lit = RULES[rule](point, sun)
    if (lit === (point.truth === 'lit')) tally.agree += 1
    else if (lit) tally.litButShadowed += 1
    else tally.darkButLit += 1
  }
  return tally
}
const pct = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`
const agreement = (tally) => pct(tally.agree, tally.n)
const detailed = (tally) => `${agreement(tally)} (${tally.litButShadowed} drawn lit but shadowed, ${tally.darkButLit} the reverse)`
const count = (points, truth) => points.filter((point) => point.truth === truth).length
const table = (head, rows) => {
  console.log(`\n| ${head.join(' | ')} |\n|${' --- |'.repeat(head.length)}`)
  for (const row of rows) console.log(`| ${row.join(' | ')} |`)
}

// ---- The tables ----

const usableOf = (points) => points.filter((point) => point.truth === 'lit' || point.truth === 'shadow')
const usable = usableOf(all)
const usedHours = run.hours.filter((hour) => usableOf(hour.points).length > 0)
const mixedHours = run.hours.filter((hour) => count(hour.points, 'lit') >= MIXED_MIN && count(hour.points, 'shadow') >= MIXED_MIN)
const mixed = usableOf(mixedHours.flatMap((hour) => hour.points))
const sitesOf = (hours) => new Set(hours.map((hour) => hour.site)).size

console.log(`Graphics: ${run.gpu}`)
console.log(`Browser: ${run.user_agent}`)
console.log(`Setting: ${run.small ? 'small screen' : 'large screen'}; picture ${run.canvas_px.join(' × ')} px from ${run.camera_height_m / 1000} km straight up`)
console.log(`Points tried: ${all.length} in ${run.hours.length} hours at ${sitesOf(run.hours)} sites (${run.month}), within ${run.sample_radius_m / 1000} km`)
console.log(`Left out: ${count(all, 'away')} facing away from the Sun, ${count(all, 'cut')} with the Sun's disk cut by the horizon`)
console.log(`Hours with no point left: ${run.hours.length - usedHours.length}`)

table(
  [`Compared at ${usable.length} points (${count(usable, 'lit')} lit, ${count(usable, 'shadow')} shadowed), ${usedHours.length} hours, ${sitesOf(usedHours)} sites`, 'Agreement'],
  [
    ['Drawn lit = more than half of full sunlight', detailed(compare(usable, 'half'))],
    ['Drawn lit = any sunlight', detailed(compare(usable, 'some'))],
  ],
)

if (mixed.length === 0) {
  console.log(`\nNo hour had at least ${MIXED_MIN} lit and ${MIXED_MIN} shadowed points, so there is no control.`)
} else {
  table(
    [`${mixed.length} points in the ${mixedHours.length} hours (${sitesOf(mixedHours)} sites) with at least ${MIXED_MIN} lit and ${MIXED_MIN} shadowed`, 'More than half', 'Any sunlight'],
    [
      ['Actual Sun direction', detailed(compare(mixed, 'half')), detailed(compare(mixed, 'some'))],
      ['Sun rotated 90°', agreement(compare(mixed, 'half', TURNED_90)), agreement(compare(mixed, 'some', TURNED_90))],
      ['Sun flipped 180°', agreement(compare(mixed, 'half', FLIPPED_180)), agreement(compare(mixed, 'some', FLIPPED_180))],
    ],
  )
}

const shadowed = usable.filter((point) => point.truth === 'shadow')
table(
  ['Shadowed points, by distance to the terrain hiding the Sun', 'Points', 'Drawn with more than half sunlight', 'Drawn with any sunlight'],
  BLOCKER_BANDS_M.slice(1).map((endM, i) => {
    const band = shadowed.filter((point) => point.rise_at_m >= BLOCKER_BANDS_M[i] && point.rise_at_m < endM)
    const wrong = (rule) => (band.length === 0 ? '0' : `${compare(band, rule).litButShadowed} (${pct(compare(band, rule).litButShadowed, band.length)})`)
    const name = Number.isFinite(endM) ? `${BLOCKER_BANDS_M[i] / 1000} to ${endM / 1000} km` : `over ${BLOCKER_BANDS_M[i] / 1000} km`
    return [name, band.length, wrong('half'), wrong('some')]
  }),
)

// The stepping itself against our model, from 2 m above each site.
const sunRadius = run.sun_radius_deg
const settled = run.model_hours.filter((hour) => hour.sun_frac === 0 || hour.sun_frac === 1)
const sameUp = (hours) => hours.filter((hour) => hour.rise_deg < sunRadius === hour.sun_frac > 0).length
const sameSettled = settled.filter((hour) => (hour.sun_frac === 1 ? hour.rise_deg < -sunRadius : hour.rise_deg > sunRadius)).length
console.log(`\nStepping vs the model's track, 2 m up, every 6th hour: same Sun up or blocked in ${sameUp(run.model_hours)} of ${run.model_hours.length} hours;`)
console.log(`where the model has the Sun fully up or fully blocked, ${sameSettled} of ${settled.length}.`)

table(
  ['Site', 'Hour (UTC)', 'Sun above level', 'Lit', 'Shadowed', 'Agreement (half)', 'Drawn lit but shadowed', 'Reverse'],
  usedHours.map((hour) => {
    const tally = compare(usableOf(hour.points), 'half')
    return [hour.site, hour.t.slice(0, 13), `${hour.sun_el}°`, count(hour.points, 'lit'), count(hour.points, 'shadow'), agreement(tally), tally.litButShadowed, tally.darkButLit]
  }),
)
