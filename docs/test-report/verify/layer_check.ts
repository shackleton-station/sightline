// Checks the Mission success probability layer (oddsField in web/src/lib/missionGrid.ts): the odds it
// paints at each pixel against a Monte Carlo simulation of landings aimed at that pixel, and against
// the panel's own odds (landingOdds) for the same target. Interior pixels only (the layer repeats the
// edge, the simulation does not).
//
// Run from web/:  npx tsx ../docs/test-report/verify/layer_check.ts [maps=20] [draws=100000]
import { cellAtM, cellChances, cellCentreM, FITS, type FitMap, landingOdds, type Spread } from '../../../web/src/lib/landingOdds'
import { fieldOf, oddsField } from '../../../web/src/lib/missionGrid'

const MAPS = Number(process.argv[2] ?? 20)
const DRAWS = Number(process.argv[3] ?? 100_000)
let seed = 7
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32
const gauss = () => Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand())
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
const sigmaOf = (accuracyM: number) => accuracyM / Math.sqrt(-2 * Math.log(0.01))

function blobMap(size: number, cellM: number): FitMap {
  const centres = Array.from({ length: 6 + Math.floor(rand() * 10) }, () => ({ x: rand() * size, y: rand() * size, fit: rand() < 0.5 }))
  const verdict = new Uint8Array(size * size)
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      let best = Infinity
      for (const c of centres) {
        const d = (c.x - col) ** 2 + (c.y - row) ** 2
        if (d < best) { best = d; verdict[row * size + col] = c.fit ? FITS : 4 }
      }
    }
  const half = (size * cellM) / 2
  return { size, cellM, leftM: -half, topM: half, verdict }
}

let worstSim = 0, worstPanel = 0, points = 0, example = ''
for (let m = 0; m < MAPS; m++) {
  const size = 120, cellM = 10
  const map = blobMap(size, cellM)
  const spread: Spread = { accuracyM: pick([50, 100, 150]), stretch: pick([1, 1, 2, 3]), bearingDeg: pick([0, 20, 45, 90, 120]) }
  const odds = oddsField(fieldOf(map), size, cellM, spread)
  const across = sigmaOf(spread.accuracyM), along = across * spread.stretch
  const b = (spread.bearingDeg * Math.PI) / 180
  const offsets = Array.from({ length: DRAWS }, () => {
    const a = gauss() * along, c = gauss() * across
    return [a * Math.sin(b) + c * Math.cos(b), a * Math.cos(b) - c * Math.sin(b)]
  })
  // The middle of the map, far enough from the edges that no landing falls off.
  const marginCells = Math.ceil((4 * along) / cellM)
  for (let k = 0; k < 12; k++) {
    const row = marginCells + Math.floor(rand() * (size - 2 * marginCells))
    const col = marginCells + Math.floor(rand() * (size - 2 * marginCells))
    const cell = row * size + col
    const { x, y } = cellCentreM(map, cell)
    let fit = 0
    for (const [dx, dy] of offsets) {
      const at = cellAtM(map, x + dx, y + dy)
      if (at !== null && map.verdict[at] === FITS) fit++
    }
    const sim = fit / DRAWS
    // The panel's odds for a target at this pixel: the same map, re-centred on it.
    const shifted: FitMap = { ...map, leftM: map.leftM - x, topM: map.topM - y }
    const panel = landingOdds(shifted, cellChances(shifted, spread)).fit
    const dSim = Math.abs(odds[cell] - sim), dPanel = Math.abs(odds[cell] - panel)
    if (dSim > worstSim) { worstSim = dSim; example = `${JSON.stringify(spread)} layer ${odds[cell].toFixed(3)} sim ${sim.toFixed(3)} panel ${panel.toFixed(3)}` }
    worstPanel = Math.max(worstPanel, dPanel)
    points++
  }
}
const noise = 5 * Math.sqrt(0.25 / DRAWS)
console.log(JSON.stringify({ maps: MAPS, points, noiseAllowance: +noise.toFixed(4), worstLayerVsSim: +worstSim.toFixed(4), worstLayerVsPanel: +worstPanel.toFixed(4), example }, null, 1))
