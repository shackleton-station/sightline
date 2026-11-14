// The co-pilot's "code version": a hash of the files its two handlers are built from.
//
//   node scripts/copilot-version.mjs      prints {"codeVersion":"…"} (run from web/)
//
// A kept answer is keyed by this and by the data version (copilot/chat/handler.ts), so an answer
// never outlives the code or the data that worked it out. It is a hash of the files and not the
// commit, so a deploy that changes nothing the handlers are built from keeps the answers. The
// co-pilot's image runs this at build time (copilot/Dockerfile). The web server's image does not:
// it has no co-pilot.
//
// The files are the ones esbuild bundles for `copilot/chat/handler.ts` and `copilot/ask.ts`: the
// handlers, the prompt, the tools, the breaker and retries, and the page's own calculations they
// reuse. Libraries in node_modules are left out: a library update does not empty the cache.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const web = fileURLToPath(new URL('..', import.meta.url))
export const ENTRY_POINTS = ['copilot/chat/handler.ts', 'copilot/ask.ts']

/** Every file the handlers are built from, relative to web/, in a fixed order. */
export async function copilotFiles() {
  const result = await build({ entryPoints: ENTRY_POINTS, absWorkingDir: web, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, outdir: 'unused', logLevel: 'silent' })
  // Not locale order, which differs between machines.
  return Object.keys(result.metafile.inputs)
    .filter((file) => !file.includes('node_modules'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The first 16 hex digits of a SHA-256 over every file's path, size and content. */
export async function copilotVersion() {
  const hash = createHash('sha256')
  for (const path of await copilotFiles()) {
    const bytes = readFileSync(new URL(path, pathToFileURL(web)))
    hash.update(`${path}\0${bytes.length}\0`)
    hash.update(bytes)
  }
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ codeVersion: await copilotVersion() }))
}
