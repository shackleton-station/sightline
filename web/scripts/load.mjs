// A small load test with no dependencies: `node scripts/load.mjs https://<site> [seconds] [workers]`.
// It asks for the things a real visit asks for (the page, site data, a terrain tile, the status
// endpoint) as fast as `workers` parallel loops can, and reports requests per second, how long
// they took, and how many failed. It never calls the endpoints that cost money (/api/ask, /api/chat).
//
// Run it from one machine and you are one address: the edge firewall bans an address that sends
// more than 3,000 requests a minute, so keep workers low or expect 429s (they are counted apart).
const base = (process.argv[2] ?? '').replace(/\/$/, '')
const seconds = Number(process.argv[3] ?? 20)
const workers = Number(process.argv[4] ?? 20)
if (!base) {
  console.error('Usage: node scripts/load.mjs <site URL> [seconds] [workers]')
  process.exit(2)
}

const PATHS = ['/', '/data/sites.json', '/data/overview/2027.json', '/data/connecting-ridge/2027-05/summary.json', '/tiles/manifest.json', '/api/status']
const times = []
const counts = { ok: 0, limited: 0, failed: 0 }
const byPath = new Map(PATHS.map((path) => [path, []]))
const end = Date.now() + seconds * 1000

async function worker(id) {
  for (let i = id; Date.now() < end; i += 1) {
    const path = PATHS[i % PATHS.length]
    const started = performance.now()
    try {
      const response = await fetch(base + path)
      await response.arrayBuffer()
      const ms = performance.now() - started
      if (response.ok) {
        counts.ok += 1
        times.push(ms)
        byPath.get(path).push(ms)
      } else if (response.status === 429) counts.limited += 1
      else counts.failed += 1
    } catch {
      counts.failed += 1
    }
  }
}

const at = (sorted, share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
const started = Date.now()
await Promise.all(Array.from({ length: workers }, (_, id) => worker(id)))
const took = (Date.now() - started) / 1000
const sorted = [...times].sort((a, b) => a - b)
const total = counts.ok + counts.limited + counts.failed

console.log(`${base}: ${workers} workers for ${took.toFixed(0)} s`)
console.log(`requests: ${total} (${(total / took).toFixed(0)} a second)  ok ${counts.ok}  refused by a rate limit ${counts.limited}  failed ${counts.failed}`)
console.log(`time to answer, ms:  median ${at(sorted, 0.5).toFixed(0)}  95% under ${at(sorted, 0.95).toFixed(0)}  99% under ${at(sorted, 0.99).toFixed(0)}  slowest ${(sorted.at(-1) ?? 0).toFixed(0)}`)
for (const [path, list] of byPath) {
  const s = [...list].sort((a, b) => a - b)
  console.log(`  ${path.padEnd(46)} ${String(list.length).padStart(5)} ok   median ${at(s, 0.5).toFixed(0).padStart(4)} ms   95% under ${at(s, 0.95).toFixed(0).padStart(4)} ms`)
}
process.exit(counts.failed > 0 ? 1 : 0)
