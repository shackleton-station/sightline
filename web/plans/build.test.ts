import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The plans service deploys only when something it is built from changed, and its image copies only
 * some folders. Both lists are written by hand, in the deploy workflow and in the Dockerfile. This
 * bundles the service the way the image does and checks that every file that went into the bundle
 * is on both lists, so an import from a new place cannot ship without a deploy, or break the image.
 */
const web = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

async function bundledFiles(): Promise<string[]> {
  const result = await build({ entryPoints: ['plans/index.ts'], absWorkingDir: web, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent' })
  return Object.keys(result.metafile.inputs).filter((file) => !file.includes('node_modules'))
}

describe('what the plans service is built from', () => {
  it('is all inside the folders the deploy workflow watches', async () => {
    const workflow = read('../../.github/workflows/deploy-plans.yml')
    const watched = (/BUILT_FROM: >-\n((?: {4}.+\n)+)/.exec(workflow)?.[1] ?? '').split(/\s+/).filter(Boolean)
    expect(watched).toContain('web/plans')
    const files = await bundledFiles()
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) expect(watched.some((path) => `web/${file}`.startsWith(`${path}/`)), `web/${file} is bundled but not in BUILT_FROM`).toBe(true)
    // The data the brief reads, and the script that hashes it, are not code and so not in the bundle.
    expect(watched).toEqual(expect.arrayContaining(['web/public/data', 'web/scripts/data-version.mjs', 'web/package-lock.json']))
  })

  it('is all copied into the image by the Dockerfile', async () => {
    const copied = [...read('./Dockerfile').matchAll(/^COPY (?!--from)(\S+) \S+$/gm)].map(([, source]) => source)
    for (const file of await bundledFiles()) expect(copied.some((path) => file.startsWith(`${path}/`)), `${file} is bundled but no COPY brings it into the image`).toBe(true)
    expect(copied).toContain('public/data')
  })

  it('needs nothing of the web server: no file from server/ is in the bundle', async () => {
    expect((await bundledFiles()).filter((file) => file.startsWith('server/'))).toEqual([])
  })
})
