// Compares the app's mission logic (viableHours, landingProblems, nextViable, betterDate) with a
// brute-force version written here from the rules alone, on the real shipped overview data.
import { readFileSync } from 'node:fs'
import { landingProblems, missionEarth, NO_GAP_LIMIT_H, viableHours, type Requirements } from '../../../web/src/lib/mission'
import { nextViable } from '../../../web/src/lib/slip'
import { betterDate, DEFAULT_MISSION } from '../../../web/src/lib/sightlineMission'
import type { SiteFlags } from '../../../web/src/lib/flags'

const DATA = process.argv[2]
const YEARS = process.argv[3].split(',')

function decodeSteps(steps: number[], hours: number): boolean[] {
  const flags = new Array<boolean>(hours).fill(false)
  let at = 0
  for (let i = 0; i + 1 < steps.length; i += 2) {
    const from = at + steps[i]
    at = from + steps[i + 1]
    flags.fill(true, from, at)
  }
  return flags
}

// Load and join several years, per site.
const sites: Record<string, SiteFlags> = {}
for (const year of YEARS) {
  const ov = JSON.parse(readFileSync(`${DATA}/overview/${year}.json`, 'utf8'))
  for (const [id, s] of Object.entries<any>(ov.sites)) {
    const site = (sites[id] ??= { start: ov.start, sun: [], earth: [], earthAbove: { '2': [], '5': [] } })
    site.sun.push(...decodeSteps(s.sun, ov.hours))
    site.earth.push(...decodeSteps(s.earth, ov.hours))
    for (const k of ['2', '5']) site.earthAbove[k].push(...decodeSteps(s.earth_above[k], ov.hours))
  }
}

// ---- brute force, from the rules: Sun/Earth up at landing if asked; mission must fit in the data;
// the longest run of Sun-down (Earth-down) hours inside [t, t + mission) must not exceed the limit.
function longestOff(flags: boolean[], from: number, to: number): number {
  let best = 0, cur = 0
  for (let i = from; i < to; i++) { cur = flags[i] ? 0 : cur + 1; if (cur > best) best = cur }
  return best
}
function bruteOk(sun: boolean[], earth: boolean[], t: number, r: Requirements): boolean {
  const end = t + r.missionDays * 24
  if (r.sunAtLanding && !sun[t]) return false
  if (r.earthAtLanding && !earth[t]) return false
  if (end > sun.length) return false
  if (longestOff(sun, t, end) > r.maxSunGapH) return false
  if (longestOff(earth, t, end) > r.maxEarthGapH) return false
  return true
}

let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]

const ids = Object.keys(sites)
let configs = 0, hoursCompared = 0, viableMismatch = 0, problemsMismatch = 0, nextMismatch = 0, betterMismatch = 0
let viableTotal = 0
const examples: string[] = []
const N = Number(process.argv[4] ?? 150)
for (let c = 0; c < N; c++) {
  const id = ids[c % ids.length]
  const f = sites[id]
  const req: Requirements = {
    missionDays: pick([1, 2, 3, 7, 10, 14, 21, 28]),
    maxSunGapH: pick([0, 1, 6, 12, 24, 48, 72, 100, 150, 200, 400, NO_GAP_LIMIT_H]),
    maxEarthGapH: pick([0, 6, 24, 72, 150, 300, NO_GAP_LIMIT_H]),
    sunAtLanding: rnd() < 0.7,
    earthAtLanding: rnd() < 0.6,
    minEarthClearanceDeg: pick([0, 0, 2, 5]),
  }
  configs++
  const earth = missionEarth(f, req)
  const viable = viableHours(f.sun, earth, req)
  const brute = new Array<boolean>(f.sun.length)
  for (let t = 0; t < f.sun.length; t++) {
    brute[t] = bruteOk(f.sun, earth, t, req)
    hoursCompared++
    if (brute[t]) viableTotal++
    if (!!viable[t] !== brute[t]) {
      viableMismatch++
      if (examples.length < 8) examples.push(`viableHours ${id} t=${t} app=${viable[t]} brute=${brute[t]} ${JSON.stringify(req)}`)
    }
    // landingProblems (what the words on screen come from) must be empty exactly when brute says ok
    if (t % 7 === 0) {
      const p = landingProblems(f.sun, earth, t, req)
      if ((p.length === 0) !== brute[t]) {
        problemsMismatch++
        if (examples.length < 8) examples.push(`landingProblems ${id} t=${t} problems=${JSON.stringify(p)} brute=${brute[t]}`)
      }
    }
  }
  // nextViable / betterDate at random landing hours
  for (let k = 0; k < 40; k++) {
    const from = Math.floor(rnd() * f.sun.length)
    let expect = -1
    for (let t = from; t < f.sun.length; t++) if (brute[t]) { expect = t; break }
    const iso = new Date(Date.parse(f.start) + from * 3_600_000).toISOString().replace('.000Z', 'Z')
    const nv = nextViable(f, iso, req)
    const got = nv ? from + nv.waitH : -1
    if (got !== expect) {
      nextMismatch++
      if (examples.length < 8) examples.push(`nextViable ${id} from=${from} app=${got} brute=${expect}`)
    }
    const bd = betterDate(f, from, { ...DEFAULT_MISSION, requirements: req })
    const expectBetter = brute[from] ? null : expect > from ? expect : null
    const gotBetter = bd ? bd.landing : null
    if (gotBetter !== expectBetter) {
      betterMismatch++
      if (examples.length < 8) examples.push(`betterDate ${id} from=${from} app=${gotBetter} brute=${expectBetter}`)
    }
  }
}
console.log(JSON.stringify({ years: YEARS, sites: ids.length, configs, hoursCompared, viableShare: +(viableTotal / hoursCompared).toFixed(3), viableMismatch, problemsMismatch, nextMismatch, betterMismatch, examples }, null, 1))
