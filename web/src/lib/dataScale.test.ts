import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { answersComputed, countWords, groundPointHours, groundPoints, horizonsChecks, largeWords, type LightGrids, monthsHours, NASA_TERRAIN_READ_GB, scaleFigures, scaleHeadline, scaleLine, type ScaleSources } from './dataScale'

/** A file of the pipeline's, as the site ships it. */
const shipped = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T

const sources: ScaleSources = {
  range: shipped('range.json'),
  siteCount: shipped<unknown[]>('sites.json').length,
  light: shipped('light/meta.json'),
  horizons: shipped('horizons.json'),
  photos: shipped('lroc-photos.json'),
}

describe('how much data the model works through', () => {
  it('counts the hours between two months in UTC, leap years included', () => {
    expect(monthsHours('2027-02', '2027-02')).toBe(28 * 24)
    expect(monthsHours('2028-02', '2028-02')).toBe(29 * 24)
    expect(monthsHours('2026-01', '2049-12')).toBe(210_384)
  })

  it('counts every grid the light layer was computed on: the two squares and the four patches', () => {
    const light: LightGrids = { size: 4, first_month: '2027-01', last_month: '2027-01', wide: { size: 2, first_month: '2027-01', last_month: '2027-02' }, patches: { a: { size: 3, first_month: '2027-02', last_month: '2027-02' } } }
    expect(groundPoints(light)).toBe(16 + 4 + 9)
    expect(groundPointHours(light)).toBe(16 * 744 + 4 * (744 + 672) + 9 * 672)
    expect(answersComputed(light, 2, 100)).toBe(2 * (16 * 744 + 4 * 1416 + 9 * 672 + 200))
    expect(groundPoints({ size: 4, first_month: '2027-01', last_month: '2027-01' })).toBe(16)
  })

  it('gives the shipped data’s figures: the grids cover the same hours as the sites, 2026 to 2049', () => {
    const light = sources.light as LightGrids
    expect(groundPoints(light)).toBe(2 * 1024 * 1024 + 4 * 306 * 306)
    expect(groundPointHours(light)).toBe(groundPoints(light) * sources.range!.hours)
    expect(answersComputed(light, 13, 210_384)).toBe(1_040_016_052_512)
    expect(horizonsChecks(sources.horizons!)).toBe(13 * 210_384 * 2)
  })

  it('writes whole numbers with thousands separators and large ones to a decimal or two', () => {
    expect(countWords(5_469_984)).toBe('5,469,984')
    expect(countWords(235)).toBe('235')
    expect(largeWords(78_797_015_424)).toBe('78.8 billion')
    expect(largeWords(1_040_016_052_512)).toBe('1.04 trillion')
    expect(largeWords(999_999)).toBe('999,999')
  })

  it('shows six figures from the shipped files, each with a few plain words', () => {
    expect(scaleFigures(sources).map((entry) => `${entry.figure} ${entry.label}`)).toEqual([
      '21 GB of NASA terrain read',
      '210,384 hours covered, 2026 to 2049',
      '2,471,696 points of the south pole, each with its own skyline',
      '1.04 trillion Sun and Earth answers computed',
      '5,469,984 checks against JPL Horizons',
      '235 dated photos from orbit compared',
    ])
    expect(NASA_TERRAIN_READ_GB).toBe(21)
    for (const entry of scaleFigures(sources)) expect(entry.label).not.toMatch(/big data|massive|huge|stored/i)
  })

  it('shows no figure before its file is here, and no line until all are', () => {
    const waiting = scaleFigures({ range: null, siteCount: 13, light: null, horizons: null, photos: null })
    expect(waiting.map((entry) => entry.figure)).toEqual(['21 GB', null, null, null, null, null])
    expect(scaleLine({ ...sources, photos: null })).toBeNull()
    expect(scaleLine(sources)).toContain('1.04 trillion Sun and Earth answers computed · 5,469,984 checks against JPL Horizons')
  })

  it('gives the first screen one line: the answers computed, and nothing else', () => {
    expect(scaleHeadline(sources.light as LightGrids, sources.siteCount, sources.range!.hours)).toBe('1.04 trillion Sun and Earth answers computed from NASA data')
  })

  it('keeps the README’s opening figures the same as the data’s', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
    for (const entry of scaleFigures(sources)) expect(readme, entry.id).toContain(entry.figure)
  })
})
