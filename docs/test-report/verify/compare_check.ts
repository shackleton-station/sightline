// Checks two things added to Compare and the verdict since the morning's report, against brute force
// written here from the rules (Earth flags, gap limits and slope read straight from the shipped data):
//  C1  "Sun and Earth together, %" (bothPct in web/src/sightline/plannerTable.ts)
//  C2  "nearest site of the same group where that date fits" (nearestFittingSite, PR #24)
//  C3  the planner's Find tab: days in each month a landing fits (findRow 'fit', PR #35). Needs consecutive years.
//
// Run from web/:  npx tsx ../docs/test-report/verify/compare_check.ts public/data 2027,2045 [configs=120]
import { readFileSync } from 'node:fs'
import { NO_GAP_LIMIT_H, type Requirements } from '../../../web/src/lib/mission'
import { DEFAULT_MISSION, nearestFittingSite, type SightlineMission } from '../../../web/src/lib/sightlineMission'
import { bothPct } from '../../../web/src/sightline/plannerTable'
import { findRow, fitHours } from '../../../web/src/sightline/plannerFit'
import { monthSpans } from '../../../web/src/lib/grid'
import type { SiteFlags } from '../../../web/src/lib/flags'

const DATA = process.argv[2]
const YEARS = process.argv[3].split(',')
const N = Number(process.argv[4] ?? 120)

function decode(steps: number[], hours: number): boolean[] {
  const flags = new Array<boolean>(hours).fill(false)
  let at = 0
  for (let i = 0; i + 1 < steps.length; i += 2) {
    const from = at + steps[i]
    at = from + steps[i + 1]
    flags.fill(true, from, at)
  }
  return flags
}
const flags: Record<string, SiteFlags> = {}
for (const year of YEARS) {
  const ov = JSON.parse(readFileSync(`${DATA}/overview/${year}.json`, 'utf8'))
  for (const [id, s] of Object.entries<any>(ov.sites)) {
    const f = (flags[id] ??= { start: ov.start, sun: [], earth: [], earthAbove: {} })
    f.sun.push(...decode(s.sun, ov.hours))
    f.earth.push(...decode(s.earth, ov.hours))
    for (const k of Object.keys(s.earth_above)) (f.earthAbove[k] ??= []).push(...decode(s.earth_above[k], ov.hours))
  }
}
const sites: any[] = JSON.parse(readFileSync(`${DATA}/sites.json`, 'utf8'))

// ---- brute force, from the rules
const earthOf = (f: SiteFlags, r: Requirements) => (r.minEarthClearanceDeg > 0 ? f.earthAbove[String(r.minEarthClearanceDeg)] : f.earth)
function longestOff(xs: boolean[], from: number, to: number) {
  let best = 0, run = 0
  for (let i = from; i < to; i++) { run = xs[i] ? 0 : run + 1; best = Math.max(best, run) }
  return best
}
function fits(f: SiteFlags, slopeDeg: number | null, t: number, m: SightlineMission): boolean {
  const r = m.requirements, earth = earthOf(f, r), end = t + r.missionDays * 24
  if (end > f.sun.length) return false
  if (r.sunAtLanding && !f.sun[t]) return false
  if (r.earthAtLanding && !earth[t]) return false
  if (longestOff(f.sun, t, end) > r.maxSunGapH) return false
  if (longestOff(earth, t, end) > r.maxEarthGapH) return false
  return slopeDeg === null || slopeDeg <= m.maxSlopeDeg
}
function haversineKm(a: any, b: any) {
  const rad = Math.PI / 180, R = 1737.4
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

let seed = 99
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]

let c1 = 0, c1bad = 0, c2 = 0, c2offered = 0, c2bad = 0, c2none = 0
const examples: string[] = []
const listed = sites.map((site) => ({ site, flags: flags[site.id] }))
for (let c = 0; c < N; c++) {
  const mission: SightlineMission = {
    ...DEFAULT_MISSION,
    maxSlopeDeg: pick([5, 10, 15]),
    requirements: {
      missionDays: pick([1, 3, 7, 14, 21, 30]),
      maxSunGapH: pick([0, 12, 24, 72, 168, NO_GAP_LIMIT_H]),
      maxEarthGapH: pick([0, 24, 72, NO_GAP_LIMIT_H]),
      sunAtLanding: rnd() < 0.7,
      earthAtLanding: rnd() < 0.6,
      minEarthClearanceDeg: pick([0, 0, 2, 5]),
    },
  }
  for (const site of sites) {
    const f = flags[site.id]
    for (let k = 0; k < 40; k++) {
      const t = Math.floor(rnd() * f.sun.length)
      // C1
      const end = t + mission.requirements.missionDays * 24
      const app = bothPct(f, t, mission)
      let brute: number | null = null
      if (end <= f.sun.length) {
        const earth = earthOf(f, mission.requirements)
        let up = 0
        for (let h = t; h < end; h++) if (f.sun[h] && earth[h]) up++
        brute = (100 * up) / (end - t)
      }
      c1++
      if ((app === null) !== (brute === null) || (app !== null && brute !== null && Math.abs(app - brute) > 1e-9)) {
        c1bad++
        if (examples.length < 6) examples.push(`bothPct ${site.id} t=${t}: app ${app} brute ${brute}`)
      }
      // C2: only offered when this site does not fit
      if (fits(f, site.slope?.deg ?? null, t, mission)) continue
      c2++
      const app2 = nearestFittingSite(site, t, mission, listed)
      const candidates = sites
        .filter((o) => o.id !== site.id && o.group === site.group && fits(flags[o.id], o.slope?.deg ?? null, t, mission))
        .map((o) => ({ id: o.id, km: haversineKm(site, o) }))
        .sort((a, b) => a.km - b.km)
      const want = candidates[0] ?? null
      if (app2) c2offered++
      else c2none++
      if ((app2 === null) !== (want === null) || (app2 && want && (app2.site.id !== want.id || Math.abs(app2.km - want.km) > 0.01))) {
        c2bad++
        if (examples.length < 6) examples.push(`nearest ${site.id} t=${t}: app ${app2?.site.id} ${app2?.km.toFixed(2)} brute ${want?.id} ${want?.km.toFixed(2)}`)
      }
    }
  }
}
// ---- C3: days a month a landing fits, months worked out here from the calendar
let c3 = 0, c3bad = 0
const first = Number(YEARS[0])
const consecutive = YEARS.every((y, i) => Number(y) === first + i)
if (consecutive) {
  const hours = flags[sites[0].id].sun.length
  const spans = monthSpans(`${first}-01-01T00:00:00Z`, hours)
  for (let c = 0; c < 40; c++) {
    const mission: SightlineMission = {
      ...DEFAULT_MISSION,
      maxSlopeDeg: pick([5, 10, 15]),
      requirements: { missionDays: pick([1, 7, 14, 30]), maxSunGapH: pick([0, 24, 72, 168, NO_GAP_LIMIT_H]), maxEarthGapH: pick([0, 72, NO_GAP_LIMIT_H]), sunAtLanding: rnd() < 0.7, earthAtLanding: rnd() < 0.6, minEarthClearanceDeg: pick([0, 2, 5]) },
    }
    for (const site of sites) {
      const f = flags[site.id]
      const row = findRow('fit', f, fitHours(f, mission, site.slope?.deg ?? null), spans)
      let hour = 0
      for (let y = first; y < first + YEARS.length; y++)
        for (let m = 0; m < 12; m++) {
          const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
          let fitDays = 0
          for (let d = 0; d < daysInMonth; d++) {
            let any = false
            for (let h = 0; h < 24; h++) if (fits(f, site.slope?.deg ?? null, hour + d * 24 + h, mission)) { any = true; break }
            if (any) fitDays++
          }
          hour += daysInMonth * 24
          const cell = row[(y - first) * 12 + m]
          c3++
          if (!cell || cell.days !== fitDays) {
            c3bad++
            if (examples.length < 8) examples.push(`find ${site.id} ${y}-${m + 1}: app ${cell?.days} brute ${fitDays}`)
          }
        }
    }
  }
}
console.log(JSON.stringify({ configs: N, C3_findDays: { siteMonths: c3, mismatches: c3bad, ran: consecutive }, C1_bothPct: { checked: c1, mismatches: c1bad }, C2_nearestFittingSite: { landingsThatDoNotFit: c2, siteOffered: c2offered, noneOffered: c2none, mismatches: c2bad }, examples }, null, 1))
