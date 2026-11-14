// The "data version": a hash of the site data's content.
//
//   node scripts/data-version.mjs public/data      prints {"dataVersion":"…"}
//
// Every service reports the data version it was built with in its status. Two services built from
// commits that carry the same data report the same value, even if one of them was not rebuilt, which
// is why this is a hash of the files and not the commit. It covers every file under the folder: its
// path, its size and its bytes, in a fixed order. Used by `vite build` (vite.config.ts), by the
// events worker's image (events-worker/Dockerfile) and by the deploy workflows.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Every file under `dir`, as paths relative to it with forward slashes, sorted by their bytes. */
function filesUnder(dir) {
  const found = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name !== '.DS_Store') found.push(relative(dir, path).split(sep).join('/'))
    }
  }
  walk(dir)
  // Not locale order, which differs between machines.
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The first 16 hex digits of a SHA-256 over every file's path, size and content. */
export function dataVersion(dir) {
  const hash = createHash('sha256')
  for (const path of filesUnder(dir)) {
    const bytes = readFileSync(join(dir, path))
    hash.update(`${path}\0${bytes.length}\0`)
    hash.update(bytes)
  }
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node scripts/data-version.mjs <data folder>')
    process.exit(2)
  }
  console.log(JSON.stringify({ dataVersion: dataVersion(dir) }))
}
