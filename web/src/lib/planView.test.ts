import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS as DEFAULT_REQUIREMENTS } from '../../shared/tools/defaults'
import { cleanPlanView, markSightline, panelIn, savedBySightline, withPanel } from './planView'

const BASE = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00'
const clean = (view: string) => cleanPlanView(view, DEFAULT_REQUIREMENTS)?.view ?? null

describe('cleanPlanView', () => {
  it('keeps the app\'s own link as it is', () => {
    expect(clean(BASE)).toBe(BASE)
    expect(cleanPlanView(BASE, DEFAULT_REQUIREMENTS)?.state.shortlist).toHaveLength(2)
  })

  it('keeps every value the Sightline screen adds: slope, heights, the scenario on show, accuracy, the skyline, the Planner\'s tab, the open panel', () => {
    const whole = `${BASE}&slope=8&hp=5&ha=10&sc=2&acc=250&accs=1.5&accd=40&sky=1&planner=compare&panel=compare`
    expect(clean(whole)).toBe(whole)
  })

  it('writes them back in its own order, whatever order they came in', () => {
    expect(clean(`${BASE}&panel=layers&sc=1&hp=10&slope=12`)).toBe(`${BASE}&slope=12&hp=10&sc=1&panel=layers`)
  })

  it('drops what it does not know, and a known name with a value it cannot hold', () => {
    expect(clean(`${BASE}&evil=<script>&hp=7&ha=3&sc=9&planner=other&panel=hype&sky=yes&slope=steep&acc=1e9`)).toBe(BASE)
    expect(clean(`${BASE}&hp=5&hp=10`)).toBe(`${BASE}&hp=5`)
  })

  it('refuses a view the app cannot open', () => {
    expect(clean('https://evil.example')).toBeNull()
    expect(clean('#t=4&slope=8')).toBeNull()
  })
})

describe('the open panel in a view', () => {
  it('is added for saving and read back', () => {
    expect(withPanel(BASE, 'compare')).toBe(`${BASE}&panel=compare`)
    expect(panelIn(withPanel(BASE, 'compare'))).toBe('compare')
  })

  it('is left out when no panel is open, and replaces one already there', () => {
    expect(withPanel(BASE, null)).toBe(BASE)
    expect(withPanel(`${BASE}&panel=layers`, null)).toBe(BASE)
    expect(withPanel(`${BASE}&panel=layers`, 'accuracy')).toBe(`${BASE}&panel=accuracy`)
  })

  it('never carries the easter egg, or a panel that does not exist', () => {
    expect(withPanel(BASE, 'hype')).toBe(BASE)
    expect(panelIn(`${BASE}&panel=hype`)).toBeNull()
    expect(panelIn(`${BASE}&panel=<b>`)).toBeNull()
    expect(panelIn(BASE)).toBeNull()
  })

  it('does not carry a panel the screen no longer has: the mission is no panel now', () => {
    expect(withPanel(BASE, 'mission')).toBe(BASE)
    expect(panelIn(`${BASE}&panel=mission`)).toBeNull()
    expect(clean(`${BASE}&panel=advanced`)).toBe(BASE)
  })
})

describe('the mark of a plan saved from the Sightline screen', () => {
  it('is added once, last, and read back', () => {
    expect(markSightline(BASE)).toBe(`${BASE}&sl=1`)
    expect(markSightline(markSightline(BASE))).toBe(`${BASE}&sl=1`)
    expect(savedBySightline(markSightline(BASE))).toBe(true)
  })

  it('is kept by the service, after everything else, and only as the mark itself', () => {
    expect(clean(`${BASE}&sl=1&panel=compare&slope=8`)).toBe(`${BASE}&slope=8&panel=compare&sl=1`)
    expect(clean(`${BASE}&sl=yes`)).toBe(BASE)
  })

  it('is absent from an older plan, whose view the service stored without it', () => {
    expect(savedBySightline(BASE)).toBe(false)
    expect(savedBySightline(`${BASE}&sl=0`)).toBe(false)
  })
})
