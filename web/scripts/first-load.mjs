// What a page downloads when it first opens, in headless Chrome with an empty cache: every request,
// its bytes over the wire, and the totals. Used to check that a change to the data (more years, a
// new file) did not make the first load heavier.
//
// Run it from web/:
//
//   node scripts/first-load.mjs https://shackletonstation.dev/sightline/
//   node scripts/first-load.mjs <url> --json=before.json        also save the list
//   node scripts/first-load.mjs <url> --compare=before.json     and say what changed against a saved list
//   node scripts/first-load.mjs <url> --quiet-ms=4000           how long the network must stay quiet (default 3000)
//
// Needs Google Chrome (set CHROME to its path if it isn't in the usual place).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, ...rest] = process.argv.slice(2)
const args = new Map(rest.map((arg) => arg.replace(/^--/, '').split('=')))
if (!url) {
  console.error('Usage: node scripts/first-load.mjs <url> [--json=file] [--compare=file] [--quiet-ms=3000]')
  process.exit(2)
}
const QUIET_MS = Number(args.get('quiet-ms') ?? 3000)
const TIMEOUT_MS = 60_000

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'first-load-'))
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,900', 'about:blank'], {
  stdio: 'ignore',
})
const stop = () => {
  browser.kill()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}

/** Chrome writes the port it chose for DevTools into its profile folder. */
async function devtoolsUrl() {
  const file = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, 'utf8').trim().split('\n')
      if (port && path) return `ws://127.0.0.1:${port}${path}`
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('Chrome did not start.')
}

try {
  const socket = new WebSocket(await devtoolsUrl())
  await new Promise((open, fail) => {
    socket.onopen = open
    socket.onerror = () => fail(new Error('Could not connect to Chrome.'))
  })
  let nextId = 1
  const waiting = new Map()
  const listeners = []
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message)
      waiting.delete(message.id)
    } else if (message.method) for (const listen of listeners) listen(message)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((done, fail) => {
      const id = nextId++
      waiting.set(id, (message) => (message.error ? fail(new Error(`${method}: ${message.error.message}`)) : done(message.result)))
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Network.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

  const requests = new Map()
  let lastActivity = Date.now()
  let open = 0
  listeners.push((message) => {
    if (message.sessionId !== sessionId) return
    const p = message.params
    if (message.method === 'Network.requestWillBeSent') {
      if (p.request.url.startsWith('data:') || p.request.url.startsWith('blob:')) return
      if (!requests.has(p.requestId)) open += 1
      requests.set(p.requestId, { url: p.request.url, bytes: 0, status: 0, done: false })
      lastActivity = Date.now()
    } else if (message.method === 'Network.responseReceived' && requests.has(p.requestId)) {
      requests.get(p.requestId).status = p.response.status
    } else if ((message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') && requests.has(p.requestId)) {
      const request = requests.get(p.requestId)
      if (!request.done) open -= 1
      request.done = true
      request.bytes = p.encodedDataLength ?? 0
      lastActivity = Date.now()
    }
  })

  const started = Date.now()
  await send('Page.navigate', { url }, sessionId)
  while (Date.now() - started < TIMEOUT_MS && (open > 0 || Date.now() - lastActivity < QUIET_MS)) {
    await new Promise((done) => setTimeout(done, 100))
  }
  socket.close()

  const origin = new URL(url).origin
  const rows = [...requests.values()]
    .filter((request) => request.done)
    .map(({ url: full, bytes, status }) => ({ path: full.startsWith(origin) ? full.slice(origin.length) : full, bytes, status }))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  const kind = (path) => (path.startsWith('/data/') ? 'data' : path.startsWith('/tiles/') ? 'tiles' : path.startsWith('/api/') ? 'api' : path.startsWith('/') ? 'app' : 'other')
  const totals = {}
  for (const row of rows) {
    const total = (totals[kind(row.path)] ??= { requests: 0, bytes: 0 })
    total.requests += 1
    total.bytes += row.bytes
  }
  const all = { requests: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0) }
  for (const row of rows.filter((r) => kind(r.path) === 'data' || kind(r.path) === 'tiles')) console.log(`${String(row.bytes).padStart(9)}  ${row.status}  ${row.path}`)
  console.log(JSON.stringify({ url, totals, all }))
  if (args.has('json')) writeFileSync(args.get('json'), JSON.stringify({ url, rows, totals, all }, null, 1))
  if (args.has('compare')) {
    const before = JSON.parse(readFileSync(args.get('compare'), 'utf8'))
    const old = new Map(before.rows.map((row) => [row.path, row.bytes]))
    const now = new Map(rows.map((row) => [row.path, row.bytes]))
    // Bundles carry a hash in their name, so only data and tiles are compared file by file.
    const isData = (path) => kind(path) === 'data' || kind(path) === 'tiles'
    const added = rows.filter((row) => isData(row.path) && !old.has(row.path))
    const gone = before.rows.filter((row) => isData(row.path) && !now.has(row.path))
    for (const row of added) console.log(`  new:  ${row.bytes}  ${row.path}`)
    for (const row of gone) console.log(`  gone: ${row.bytes}  ${row.path}`)
    for (const k of ['data', 'tiles']) {
      const was = before.totals[k]?.bytes ?? 0
      const is = totals[k]?.bytes ?? 0
      console.log(`  ${k}: ${was} -> ${is} bytes (${is - was >= 0 ? '+' : ''}${is - was})`)
    }
    console.log(`  everything: ${before.all.bytes} -> ${all.bytes} bytes`)
  }
} finally {
  stop()
}
