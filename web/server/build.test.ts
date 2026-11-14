import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The web server is the front door: pages, tiles, video, voice, rooms and its own status. The
 * co-pilot and plans are their own services, with their own identities: the web server's identity
 * cannot call the model or touch the plans database. This bundles the server the way its image does
 * (`npm run build:server`) and checks that none of their code is in it, so an import that would
 * bring a handler back cannot ship. Code two services need lives in `shared/`.
 */
const web = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

async function bundledFiles(): Promise<string[]> {
  const result = await build({ entryPoints: ['server/index.ts'], absWorkingDir: web, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent' })
  return Object.keys(result.metafile.inputs)
}

describe('what the web server is built from', () => {
  it('has no file of the co-pilot, plans or the events worker in its bundle', async () => {
    const files = await bundledFiles()
    expect(files).toContain('server/app.ts')
    expect(files.filter((file) => /^(copilot|plans|events-worker)\//.test(file))).toEqual([])
  })

  it('is its own folder, the shared folder and the page’s own helpers for rooms and the voice, nothing else', async () => {
    const files = await bundledFiles()
    expect(files.length).toBeGreaterThan(15)
    for (const file of files) expect(/^(server|shared|src\/lib)\//.test(file), `${file} is bundled into the web server`).toBe(true)
    // The data tools read the pipeline's JSON for the co-pilot's answers and a plan's brief. The web
    // server only serves those files to pages; it never reads them.
    expect(files.filter((file) => file.startsWith('shared/tools/'))).toEqual([])
  })

  it('is bundled by the same command this test runs', () => {
    const scripts = (JSON.parse(read('../package.json')) as { scripts: Record<string, string> }).scripts
    expect(scripts['build:server']).toBe('esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/index.js')
  })

  it('does not put the co-pilot’s code version in the image: only the co-pilot service has one', () => {
    expect(read('../Dockerfile')).not.toContain('copilot-version')
  })
})
