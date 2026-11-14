import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { copilotFiles, copilotVersion } from '../scripts/copilot-version.mjs'

/**
 * The co-pilot service deploys only when something it is built from changed, and its image copies
 * only some folders. Both lists are written by hand, in the deploy workflow and in the Dockerfile.
 * This bundles the service the way the image does and checks that every file that went into the
 * bundle is on both lists, so an import from a new place cannot ship without a deploy, or break the
 * image. The same for the files the code version is a hash of.
 */
const web = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

async function bundledFiles(): Promise<string[]> {
  const result = await build({ entryPoints: ['copilot/index.ts'], absWorkingDir: web, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent' })
  return Object.keys(result.metafile.inputs).filter((file) => !file.includes('node_modules'))
}

describe('what the co-pilot service is built from', () => {
  it('is all inside the folders the deploy workflow watches', async () => {
    const workflow = read('../../.github/workflows/deploy-copilot.yml')
    const watched = (/BUILT_FROM: >-\n((?: {4}.+\n)+)/.exec(workflow)?.[1] ?? '').split(/\s+/).filter(Boolean)
    expect(watched).toContain('web/copilot')
    const files = await bundledFiles()
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) expect(watched.some((path) => `web/${file}`.startsWith(`${path}/`)), `web/${file} is bundled but not in BUILT_FROM`).toBe(true)
    // The data the tools read, and the scripts that hash it and the code, are not in the bundle.
    expect(watched).toEqual(expect.arrayContaining(['web/public/data', 'web/scripts/data-version.mjs', 'web/scripts/copilot-version.mjs', 'web/package-lock.json']))
  })

  it('is all copied into the image by the Dockerfile', async () => {
    const copied = [...read('./Dockerfile').matchAll(/^COPY (?!--from)(\S+) \S+$/gm)].map(([, source]) => source)
    for (const file of await bundledFiles()) expect(copied.some((path) => file.startsWith(`${path}/`)), `${file} is bundled but no COPY brings it into the image`).toBe(true)
    expect(copied).toEqual(expect.arrayContaining(['public/data', 'scripts/copilot-version.mjs']))
  })

  it('needs nothing of the web server: no file from server/ is in the bundle', async () => {
    expect((await bundledFiles()).filter((file) => file.startsWith('server/'))).toEqual([])
  })

  it('keys kept answers by a hash of the handlers’ own files, which are all in the service', async () => {
    const files = await copilotFiles()
    const bundled = await bundledFiles()
    expect(files).toEqual(expect.arrayContaining(['copilot/chat/handler.ts', 'copilot/chat/prompt.ts', 'copilot/ask.ts', 'copilot/modelCall.ts', 'shared/tools/tools.ts']))
    for (const file of files) expect(bundled, file).toContain(file)
    // The site data is the data version's business, not the code's.
    expect(files.filter((file) => file.startsWith('public/data/') && file !== 'public/data/sites.json')).toEqual([])
    expect(await copilotVersion()).toMatch(/^[0-9a-f]{16}$/)
  })
})
