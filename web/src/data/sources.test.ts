import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DATA_SOURCES, SOURCE_GROUPS, sourcesIn } from './sources'

const REFERENCES = readFileSync(new URL('../../../REFERENCES.md', import.meta.url), 'utf8')

/** The first cell of every table row in REFERENCES.md, with the heading it sits under. */
function rows(): { section: string; name: string }[] {
  const found: { section: string; name: string }[] = []
  let section = ''
  for (const line of REFERENCES.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim()
    if (!line.startsWith('| ') || line.startsWith('| ---')) continue
    const name = line.split('|')[1].trim()
    // A table's header row.
    if (['Name', 'File', 'Item', 'Source'].includes(name)) continue
    found.push({ section, name })
  }
  return found
}

/**
 * Rows of the two data tables that the app itself never uses, each with the reason. A new dataset
 * row belongs in the registry or, if it only backs a document, here.
 */
const NOT_IN_THE_APP: Record<string, string> = {
  'Gläser et al. 2014': 'context in docs/VALIDATION.md only',
}

describe('the data sources registry and REFERENCES.md', () => {
  const all = rows()

  it('finds the two data tables', () => {
    expect(all.filter((row) => row.section === 'Datasets').length).toBeGreaterThan(10)
    expect(all.filter((row) => row.section === 'SPICE kernels').length).toBe(5)
  })

  it('gives every source a unique id', () => {
    const ids = DATA_SOURCES.map((source) => source.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cites every address the registry gives', () => {
    const missing = DATA_SOURCES.flatMap((source) => source.urls.filter((url) => !REFERENCES.includes(url)).map((url) => `${source.id}: ${url}`))
    expect(missing).toEqual([])
  })

  it('points every source at a row that exists', () => {
    const missing = DATA_SOURCES.flatMap((source) => source.refs.filter((ref) => !all.some((row) => row.name.startsWith(ref))).map((ref) => `${source.id}: ${ref}`))
    expect(missing).toEqual([])
  })

  it('has a source for every dataset and kernel row', () => {
    const refs = DATA_SOURCES.flatMap((source) => source.refs)
    const unclaimed = all
      .filter((row) => row.section === 'Datasets' || row.section === 'SPICE kernels')
      .filter((row) => !refs.some((ref) => row.name.startsWith(ref)))
      .filter((row) => !Object.keys(NOT_IN_THE_APP).some((start) => row.name.startsWith(start)))
      .map((row) => row.name)
    expect(unclaimed).toEqual([])
  })

  it('puts every source in a section the page shows', () => {
    const shown = SOURCE_GROUPS.flatMap((group) => sourcesIn(group.id))
    expect(shown.length).toBe(DATA_SOURCES.length)
  })

  it('lists JPL Horizons, Quickmap and Moon Trek among the challenge’s Resources', () => {
    expect(sourcesIn('challenge').map((source) => source.id)).toEqual(expect.arrayContaining(['horizons', 'quickmap', 'moon-trek']))
  })

  it('badges all four of the challenge’s Resources: the three tools, and the Canadian Space Agency among the partners', () => {
    const badged = DATA_SOURCES.filter((source) => source.group === 'challenge' || source.challengeResource).map((source) => source.id)
    expect(badged.sort()).toEqual(['csa-rover', 'horizons', 'moon-trek', 'quickmap'])
    expect(sourcesIn('partner').map((source) => source.id)).toContain('csa-rover')
  })
})
