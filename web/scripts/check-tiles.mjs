// Stops an upload that would remove the fine terrain tiles from the live site. Tiles stay out of Git,
// so a fresh checkout has none until the pipeline builds them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const root = new URL('../public/tiles/', import.meta.url)
const manifest = new URL('manifest.json', root)

if (!existsSync(manifest)) {
  console.error('No terrain tiles in web/public/tiles. Run: cd pipeline && uv run python scripts/run_all.py')
  process.exit(1)
}
const expected = JSON.parse(readFileSync(manifest, 'utf8'))
for (const [kind, count] of Object.entries(expected)) {
  // Files only: a folder beside the tiles (global/color/, the 8K color map) is not a tile.
  const found = readdirSync(new URL(`${kind}/`, root), { withFileTypes: true }).filter((entry) => entry.isFile()).length
  if (found !== count) {
    console.error(`Expected ${count} ${kind} tiles, found ${found}. Rerun the pipeline.`)
    process.exit(1)
  }
}
console.log('Terrain tiles present:', expected)
