// Records the numbers on the comparison page at /gpu/ (the globe on WebGL2 next to the same globe on WebGPU).
//
// Run it from web/, after `npm install` and `npm run build`:
//
//   node scripts/gpu-compare.mjs                      prints the tables
//   node scripts/gpu-compare.mjs --out=some/folder    also saves a screenshot of each state and the raw numbers
//   node scripts/gpu-compare.mjs --loads=3            how many times each globe is loaded alone (5 unless said)
//   node scripts/gpu-compare.mjs --no-webgpu          hides WebGPU from the page, to see what a browser without it gets
//
// It serves the built site (dist/), opens /gpu/ in headless Chrome at 1440 × 900 with two device pixels
// per CSS pixel, and for the whole Moon and for the pole loads the page with both globes side by side
// (for the pictures and how far apart they are), then with each globe alone, several times and taking
// turns (for the timings, so one side's work can't slow the other, and for the time to the first complete
// picture). Every load starts with an empty cache. It waits until the page's own readout covers 300
// frames, then reads it. The tables give the middle load of each, with the lowest and highest.
//
// Needs Google Chrome (set CHROME to its path if it isn't in the usual place). The result depends on the
// graphics card, so the output names the one Chrome used. Two things here are finer than in an ordinary
// tab: the site is served isolated from other origins, which lets the page's clock tick every 0.005 ms
// instead of every 0.1 ms, and --enable-webgpu-developer-features stops Chrome rounding WebGPU's GPU
// timer to 0.1 ms.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const WIDTH = 1440
const HEIGHT = 900
const PIXEL_RATIO = 2
const FRAMES = 300
const TIMEOUT_MS = 90_000
const SCENES = ['moon', 'pole']
const SIDES = ['webgl2', 'webgpu']
const LOADS_ALONE = Number(args.get('loads') ?? 5)
/** Run in the page before anything else: what a browser with no WebGPU looks like to it. */
const HIDE_WEBGPU = "Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined })"

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) =>
    existsSync(path),
  )
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}
if (!existsSync(join(webDir, 'dist/gpu/index.html'))) {
  console.error('dist/gpu/index.html is missing. Run `npm run build` first.')
  process.exit(1)
}
const outDir = args.has('out') ? resolve(args.get('out')) : null
if (outDir) mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** A connection to Chrome's DevTools protocol: send(method, params, sessionId) resolves with the result. */
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((open, fail) => {
    socket.onopen = open
    socket.onerror = () => fail(new Error('Could not connect to Chrome.'))
  })
  const waiting = new Map()
  const listeners = []
  let nextId = 1
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) return listeners.forEach((listen) => listen(message))
    const { done, fail } = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.error) fail(new Error(message.error.message))
    else done(message.result)
  }
  return {
    send(method, params = {}, sessionId = undefined) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params, sessionId }))
      return new Promise((done, fail) => waiting.set(id, { done, fail }))
    },
    onEvent: (listen) => listeners.push(listen),
    close: () => socket.close(),
  }
}

// These two headers isolate the page, which is what gives it the finer clock.
const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
const server = await preview({ root: webDir, logLevel: 'warn', preview: { port: 0, strictPort: false, headers: isolated } })
const origin = server.resolvedUrls.local[0]
const profile = mkdtempSync(join(tmpdir(), 'gpu-compare-'))
const browser = spawn(
  chrome,
  [
    '--headless=new',
    // On macOS, Chrome 157 gives a headless page real WebGPU with no flag at all; Metal is asked for so
    // WebGL2 is drawn by the same graphics card. Elsewhere WebGPU may need switching on.
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--enable-unsafe-webgpu']),
    '--enable-webgpu-developer-features',
    '--remote-debugging-port=0',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

/** Load the page one way and read its numbers once they cover enough frames. */
async function measure(cdp, scene, load) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => cdp.send(method, params, sessionId)
  const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
  try {
    await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: PIXEL_RATIO, mobile: false })
    await page('Network.enable')
    await page('Network.setCacheDisabled', { cacheDisabled: true })
    await page('Runtime.enable')
    await page('Page.enable')
    if (args.has('no-webgpu')) await page('Page.addScriptToEvaluateOnNewDocument', { source: HIDE_WEBGPU })
    const query = new URLSearchParams({ view: scene, ...(load === 'both' ? {} : { only: load }) })
    await page('Page.navigate', { url: `${origin}gpu/?${query}` })

    const deadline = Date.now() + TIMEOUT_MS
    let readouts = null
    let asked = false
    for (;;) {
      await sleep(500)
      const text = await evaluate("document.querySelector('main')?.dataset.readouts ?? null")
      readouts = text ? JSON.parse(text) : null
      const sides = readouts ? Object.values(readouts.sides) : []
      const failed = sides.find((side) => side.error)
      if (failed) throw new Error(`${scene}, ${load}: ${failed.error}`)
      const settled =
        sides.length > 0 && sides.every((side) => side.completeMs !== null && side.cpu?.n === FRAMES && (!side.timesGpu || (side.gpu?.n ?? 0) >= 60))
      if (settled && load === 'both' && !asked) {
        asked = true
        await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Compare'))?.click()")
      }
      if (settled && (load !== 'both' || readouts.difference)) break
      if (Date.now() > deadline) throw new Error(`${scene}, ${load}: timed out. Last readout: ${text}`)
    }
    if (outDir && load === 'both') {
      const { cssContentSize } = await page('Page.getLayoutMetrics')
      const shot = await page('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
      })
      writeFileSync(join(outDir, `gpu-compare-${scene}.png`), Buffer.from(shot.data, 'base64'))
    }
    return readouts
  } finally {
    await cdp.send('Target.closeTarget', { targetId })
  }
}

const results = []
let cdp
try {
  // Chrome writes the port it chose for DevTools into its profile folder.
  const portFile = join(profile, 'DevToolsActivePort')
  for (let tries = 0; !existsSync(portFile); tries += 1) {
    if (tries > 100) throw new Error('Chrome did not start.')
    await sleep(100)
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
  cdp = await connect(`ws://127.0.0.1:${port}${path}`)
  for (const scene of SCENES) {
    const loads = ['both', ...Array.from({ length: LOADS_ALONE }, () => SIDES).flat()]
    for (const load of loads) {
      console.error(`  ${scene}, ${load}…`)
      results.push({ scene, load, readouts: await measure(cdp, scene, load) })
    }
  }
} finally {
  cdp?.close()
  browser.kill()
  await new Promise((closed) => server.httpServer.close(closed))
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
if (outDir) writeFileSync(join(outDir, 'gpu-compare.json'), JSON.stringify(results, null, 2))

// ---- The tables ----

const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
/** The middle of several loads, with the lowest and highest, to two decimals. */
const spread = (values) =>
  values.some((value) => value === null || value === undefined)
    ? 'not offered'
    : `${middle(values).toFixed(2)} (${Math.min(...values).toFixed(2)} to ${Math.max(...values).toFixed(2)})`
const table = (head, rows) => {
  console.log(`\n| ${head.join(' | ')} |\n|${' --- |'.repeat(head.length)}`)
  for (const row of rows) console.log(`| ${row.join(' | ')} |`)
}
const sidesOf = (scene, load, name) => results.filter((result) => result.scene === scene && result.load === load).map(({ readouts }) => readouts.sides[name])
const row = (scene, load, name) => {
  const loads = sidesOf(scene, load, name)
  return [
    scene,
    name,
    [...new Set(loads.map((side) => side.backend))].join(', '),
    `${loads[0].widthPx} × ${loads[0].heightPx}`,
    spread(loads.map((side) => side.cpu.median)),
    spread(loads.map((side) => side.cpu.p95)),
    spread(loads.map((side) => (side.timesGpu ? side.gpu.median : null))),
    spread(loads.map((side) => (side.timesGpu ? side.gpu.p95 : null))),
    spread(loads.map((side) => side.completeMs / 1000)),
  ]
}
const head = ['View', 'Side', 'Really drawn by', 'Canvas (device px)', 'CPU median, ms', 'CPU p95, ms', 'GPU median, ms', 'GPU p95, ms', 'First complete picture, s']

const first = results[0].readouts
console.log(`Chrome: ${chrome}`)
for (const [name, side] of Object.entries(first.sides)) console.log(`${name} graphics: ${side.graphics}`)
console.log(`Screen refresh in this Chrome: every ${first.interval.median.toFixed(2)} ms (median)`)
console.log(`\nEach globe alone, ${LOADS_ALONE} loads each: the middle load (lowest to highest)`)
table(head, SCENES.flatMap((scene) => SIDES.map((name) => row(scene, name, name))))
console.log('\nBoth globes on one page, one load (each side also waits for the other)')
table(head, SCENES.flatMap((scene) => SIDES.map((name) => row(scene, 'both', name))))
console.log('\nHow far apart the two pictures are, over the pixels of the Moon')
table(
  ['View', 'Pixels compared', 'Average gap (of 255)', 'Pixels more than 8 steps apart'],
  results
    .filter(({ load }) => load === 'both')
    .map(({ scene, readouts }) => [scene, readouts.difference.pixels, readouts.difference.meanSteps.toFixed(2), `${readouts.difference.over8Pct.toFixed(2)}%`]),
)
const fellBack = results.some(({ readouts }) => readouts.sides.webgpu && readouts.sides.webgpu.backend !== 'webgpu')
console.log(fellBack ? '\nThe right side did NOT run on WebGPU: it fell back to WebGL2.' : '\nThe right side ran on WebGPU in every load.')
