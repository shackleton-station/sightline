import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dataVersion } from '../scripts/data-version.mjs'

const root = mkdtempSync(join(tmpdir(), 'clps-data-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function folder(name: string, files: Record<string, string>): string {
  const dir = join(root, name)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

describe('the data version', () => {
  const files = { 'sites.json': '[1,2]', 'site-a/2027-05/summary.json': '{"pct_sun":50}' }

  it('is the same for the same files, wherever they are and whenever they were written', () => {
    const one = dataVersion(folder('one', files))
    expect(one).toMatch(/^[0-9a-f]{16}$/)
    expect(dataVersion(folder('two', Object.fromEntries(Object.entries(files).toReversed())))).toBe(one)
  })

  it('changes when a file\'s content, name or presence changes', () => {
    const one = dataVersion(folder('base', files))
    expect(dataVersion(folder('edited', { ...files, 'sites.json': '[1,3]' }))).not.toBe(one)
    expect(dataVersion(folder('renamed', { 'sites2.json': '[1,2]', 'site-a/2027-05/summary.json': '{"pct_sun":50}' }))).not.toBe(one)
    expect(dataVersion(folder('added', { ...files, 'extra.json': '{}' }))).not.toBe(one)
    // Moving bytes from one file to the next is a change too.
    expect(dataVersion(folder('shifted', { a: 'xy', b: 'z' }))).not.toBe(dataVersion(folder('shifted2', { a: 'x', b: 'yz' })))
  })
})
