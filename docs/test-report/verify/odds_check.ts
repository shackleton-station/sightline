// Checks the landing odds (web/src/lib/landingOdds.ts) against a Monte Carlo simulation written here:
// random landings are drawn from the stated bell curve and counted cell by cell. Nothing below the
// imports reuses the app's maths.
//
// Run from web/:  npx tsx ../docs/test-report/verify/odds_check.ts [maps=60] [draws=400000]
import { bestAim, cellAtM, cellChances, FITS, type FitMap, landingOdds, largestAccuracyM, MISSES, type Spread } from '../../../web/src/lib/landingOdds'

const MAPS = Number(process.argv[2] ?? 60)
const DRAWS = Number(process.argv[3] ?? 400_000)

// Seeded random numbers, so a run can be repeated.
let seed = 20261114
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return (seed + 0.5) / 2 ** 32
}
function gauss(): number {
  return Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand())
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]

/** A map of blobs: each cell takes the reason of the nearest of a few random centres, so fit and miss come in patches like real ground. */
function blobMap(size: number, cellM: number): FitMap {
  const centres = Array.from({ length: 4 + Math.floor(rand() * 12) }, () => ({
    x: rand() * size,
    y: rand() * size,
    code: rand() < 0.5 ? FITS : 1 + Math.floor(rand() * MISSES.length),
  }))
  const verdict = new Uint8Array(size * size)
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      let best = Infinity
      for (const c of centres) {
        const d = (c.x - col) ** 2 + (c.y - row) ** 2
        if (d < best) { best = d; verdict[row * size + col] = c.code }
      }
    }
  const half = (size * cellM) / 2
  return { size, cellM, leftM: -half, topM: half, verdict }
}

/** One simulated landing for an aim at (ax, ay): a miss of sd `along` on the approach path and `across` across it. */
function land(ax: number, ay: number, across: number, along: number, bearingDeg: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180
  const a = gauss() * along
  const c = gauss() * across
  // Along the path is (sin b, cos b) on the map, clockwise from up; across it is (cos b, -sin b).
  return [ax + a * Math.sin(b) + c * Math.cos(b), ay + a * Math.cos(b) - c * Math.sin(b)]
}

/** sigma across from the accuracy radius, derived here: P(r < R) = 1 - exp(-R²/2σ²) = 0.99. */
const sigmaOf = (accuracyM: number) => accuracyM / Math.sqrt(-2 * Math.log(0.01))

const out: Record<string, unknown> = {}

// ---- O1: odds on random maps, aligned and turned approach paths
let worstFit = 0, worstMiss = 0, worstCovered = 0, worstExample = ''
for (let m = 0; m < MAPS; m++) {
  const map = blobMap(pick([60, 80, 100]), pick([10, 20, 30]))
  const reach = (map.size * map.cellM) / 2
  const stretch = pick([1, 1.5, 2, 3, 4])
  const bearingDeg = pick([0, 90, 5, 30, 45, 60, 135, 170])
  const accuracyM = Math.max(50, Math.min(reach / (1.25 * stretch), pick([50, 100, 200, 400, 800])))
  const spread: Spread = { accuracyM, stretch, bearingDeg }
  const app = landingOdds(map, cellChances(map, spread))
  const across = sigmaOf(accuracyM)
  const counts = new Float64Array(MISSES.length + 1)
  let on = 0
  for (let i = 0; i < DRAWS; i++) {
    const [x, y] = land(0, 0, across, across * stretch, bearingDeg)
    const cell = cellAtM(map, x, y)
    if (cell === null) continue
    on++
    counts[map.verdict[cell]]++
  }
  const fit = counts[FITS] / on
  const dFit = Math.abs(fit - app.fit)
  const dMiss = Math.max(...MISSES.map((miss, i) => Math.abs(counts[i + 1] / on - app.misses[miss])))
  const dCovered = Math.abs(on / DRAWS - app.covered)
  if (dFit > worstFit) { worstFit = dFit; worstExample = `map ${m}: ${JSON.stringify(spread)} app ${app.fit.toFixed(4)} sim ${fit.toFixed(4)}` }
  worstMiss = Math.max(worstMiss, dMiss)
  worstCovered = Math.max(worstCovered, dCovered)
}
// One standard error at p = 0.5 is sqrt(0.25 / DRAWS); five of them is the noise allowance.
const noise = 5 * Math.sqrt(0.25 / DRAWS)
out.O1_odds = { maps: MAPS, drawsEach: DRAWS, noiseAllowance: +noise.toFixed(4), worstFit: +worstFit.toFixed(4), worstMissReason: +worstMiss.toFixed(4), worstCovered: +worstCovered.toFixed(4), worstExample, pass: worstFit < noise && worstMiss < noise && worstCovered < noise }

// ---- O2: the accuracy radius holds 99% (inside the ellipse acc × stretch·acc along the path)
const o2: string[] = []
let o2pass = true
for (const [accuracyM, stretch] of [[100, 1], [250, 1], [100, 2], [400, 4]]) {
  let inside = 0
  const across = sigmaOf(accuracyM)
  for (let i = 0; i < DRAWS; i++) {
    const a = gauss() * across * stretch
    const c = gauss() * across
    if ((a / (stretch * accuracyM)) ** 2 + (c / accuracyM) ** 2 <= 1) inside++
  }
  const share = inside / DRAWS
  o2.push(`acc ${accuracyM} m, stretch ${stretch}: ${(100 * share).toFixed(2)}%`)
  if (Math.abs(share - 0.99) > noise) o2pass = false
}
out.O2_radius_holds_99 = { results: o2, pass: o2pass }

// ---- O3: largestAccuracyM: a square reaching 1.25 radii each way loses about 1 landing in 3,000
{
  const map = blobMap(100, 20)
  let worst = 0
  for (const stretch of [1, 2, 4]) {
    const accuracyM = largestAccuracyM(map, stretch)
    for (const bearingDeg of [0, 45, 90]) {
      let off = 0
      const across = sigmaOf(accuracyM)
      for (let i = 0; i < DRAWS; i++) if (cellAtM(map, ...land(0, 0, across, across * stretch, bearingDeg)) === null) off++
      worst = Math.max(worst, off / DRAWS)
    }
  }
  out.O3_largest_accuracy = { worstShareOffMap: +worst.toFixed(5), oneIn: Math.round(1 / Math.max(worst, 1e-9)), claim: 'about 1 in 3,000', pass: worst < 1 / 1500 }
}

// ---- O4: bestAim is the best aim within reach (same grid of aims, judged here by simulation)
let o4checked = 0, o4found = 0, o4worse = 0, o4claimOff = 0, o4missed = 0
const o4examples: string[] = []
for (let m = 0; m < 25; m++) {
  const map = blobMap(80, 20)
  const spread: Spread = { accuracyM: pick([50, 100, 150]), stretch: pick([1, 2]), bearingDeg: pick([0, 30, 90]) }
  const withinM = 200
  const chances = cellChances(map, spread)
  const aim = bestAim(map, chances, withinM)
  // Common random landings, slid to each aim, so aims are compared on the same draws.
  const across = sigmaOf(spread.accuracyM)
  const n = 60_000
  const offsets = Array.from({ length: n }, () => land(0, 0, across, across * spread.stretch, spread.bearingDeg))
  const simOdds = (ax: number, ay: number): number | null => {
    let fit = 0, on = 0
    for (const [x, y] of offsets) {
      const cell = cellAtM(map, x + ax, y + ay)
      if (cell === null) continue
      on++
      if (map.verdict[cell] === FITS) fit++
    }
    return on >= 0.995 * n ? fit / on : null
  }
  const here = simOdds(0, 0)
  if (here === null) continue
  o4checked++
  let bestSim = here
  for (let dy = -10; dy <= 10; dy += 2)
    for (let dx = -10; dx <= 10; dx += 2) {
      if (Math.hypot(dx, dy) * 20 > withinM) continue
      const odds = simOdds(dx * 20, dy * 20)
      if (odds !== null && odds > bestSim) bestSim = odds
    }
  const tol = 4 * Math.sqrt(0.25 / n) + 0.003
  if (aim) {
    o4found++
    const sim = simOdds(aim.x, aim.y)
    if (sim === null || Math.abs(sim - aim.fit) > tol) { o4claimOff++; o4examples.push(`map ${m}: aim claims ${aim.fit.toFixed(3)}, sim ${sim}`) }
    if (bestSim > aim.fit + tol) { o4worse++; o4examples.push(`map ${m}: sim found ${bestSim.toFixed(3)} > aim ${aim.fit.toFixed(3)}`) }
  } else if (bestSim > here + 0.01 + tol) {
    o4missed++
    o4examples.push(`map ${m}: no aim offered, but sim found ${bestSim.toFixed(3)} vs ${here.toFixed(3)} at the target`)
  }
}
out.O4_best_aim = { maps: o4checked, aimsOffered: o4found, claimedOddsOff: o4claimOff, betterAimFound: o4worse, aimMissed: o4missed, examples: o4examples.slice(0, 5), pass: o4claimOff + o4worse + o4missed === 0 }

console.log(JSON.stringify(out, null, 1))
