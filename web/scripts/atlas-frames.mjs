// Measures what a frame of the Atlas costs while time plays, while time is scrubbed and during a flight.
//
// Run it from web/, with the dev server (or any copy of the site) already running and nothing else busy:
//
//   node scripts/atlas-frames.mjs                         http://localhost:5173
//   node scripts/atlas-frames.mjs https://lunarsightline.com
//
// It opens the Atlas in headless Chrome at 1440 x 900 with two device pixels per CSS pixel, and wraps
// requestAnimationFrame so that every frame's work is timed up to the moment the graphics card has
// finished drawing it (one pixel is read back, which waits for the card). In the scrubbing scenario
// that work includes React re-rendering the page for the new hour. It reports, for each scenario: that
// cost per frame, the time between frames, and how many frames kept the page busy for over 50 ms.
// Headless Chrome draws at most 60 frames a second, so judge speed by the cost, not the rate. The
// globe draws only when something changes: while the month plays that is every 60 ms, by design.
// No dependencies: it speaks Chrome's debugging protocol over a WebSocket. Needs Google Chrome (set
// CHROME to its path if it isn't in the usual place). The result depends on the graphics card, so the
// output names the one Chrome used.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const site = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '')
const page = `${site}/atlas/#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&view=3d&mode=learn`
const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'atlas-frames-'))
const browser = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--force-device-scale-factor=2',
  '--enable-gpu',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  'about:blank',
])
const stop = async () => {
  const gone = new Promise((resolve) => browser.on('exit', resolve))
  browser.kill()
  await gone
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

/** Chrome prints the address of its debugging socket when it is ready. */
const socketUrl = await new Promise((resolve, reject) => {
  let seen = ''
  browser.stderr.on('data', (chunk) => {
    seen += chunk
    const found = /DevTools listening on (ws:\/\/\S+)/.exec(seen)
    if (found) resolve(found[1])
  })
  browser.on('exit', () => reject(new Error(`Chrome exited before it was ready:\n${seen}`)))
  setTimeout(() => reject(new Error('Chrome did not start within 20 s')), 20_000)
})

const socket = new WebSocket(socketUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let lastId = 0
const waiting = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const pending = waiting.get(message.id)
  if (!pending) return
  waiting.delete(message.id)
  if (message.error) pending.reject(new Error(message.error.message))
  else pending.resolve(message.result)
}
/** One command to Chrome, optionally to one tab's session. */
function send(method, params = {}, sessionId) {
  const id = ++lastId
  socket.send(JSON.stringify({ id, method, params, sessionId }))
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
/** Runs code in the page and returns its value (promises are waited for). */
async function inPage(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

// Before any of the page's own code: time every animation frame's work, through to the GPU.
await send(
  'Page.addScriptToEvaluateOnNewDocument',
  {
    source: `
      window.__frames = { cost: [], at: [], busy: 0 }
      const pixel = new Uint8Array(4)
      const request = window.requestAnimationFrame.bind(window)
      let frameAt = -1
      window.requestAnimationFrame = (callback) =>
        request((time) => {
          const start = performance.now()
          callback(time)
          // Reading a pixel back waits until the graphics card has really drawn the frame.
          const gl = document.querySelector('.atlas-globe canvas')?.getContext('webgl2')
          gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
          const cost = performance.now() - start
          // Several callbacks can share a frame: their costs add up to that frame's.
          if (time === frameAt) window.__frames.cost[window.__frames.cost.length - 1] += cost
          else {
            frameAt = time
            window.__frames.cost.push(cost)
            window.__frames.at.push(time)
          }
        })
      new PerformanceObserver((list) => { window.__frames.busy += list.getEntries().length }).observe({ type: 'long-animation-frame' })
    `,
  },
  sessionId,
)
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: page }, sessionId)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Waits until the page says something is true, or gives up. */
async function until(expression, what, timeoutMs = 60_000) {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await sleep(250)) {
    if (await inPage(expression).catch(() => false)) return
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** Clears the samples, lets `act` drive the page for a while, and returns what the frames cost. */
async function measure(name, act, ms) {
  await inPage('window.__frames.cost.length = 0; window.__frames.at.length = 0; window.__frames.busy = 0; true')
  await inPage(act)
  await sleep(ms)
  const { cost, at, busy } = await inPage('window.__frames')
  const gaps = at.slice(1).map((time, i) => time - at[i])
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const pick = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? Number.NaN
    return `median ${pick(0.5).toFixed(1)}, 95th ${pick(0.95).toFixed(1)}, worst ${pick(1).toFixed(1)} ms`
  }
  console.log(`${name}: ${cost.length} frames`)
  console.log(`  a frame's work, through to the GPU: ${stats(cost)}`)
  console.log(`  between frames:                     ${stats(gaps)}`)
  console.log(`  frames busy over 50 ms:             ${busy}`)
}

try {
  await until(`!!document.querySelector('.atlas-globe canvas') && !!document.querySelector('.river-play')`, 'the Atlas to open')
  await until(`!/Loading/.test(document.querySelector('.atlas-fine')?.textContent ?? 'Loading')`, "the month's light to load")
  const lightNote = await inPage(`document.querySelector('.atlas-fine').textContent`)
  await sleep(4000) // the first flight down to the site, and the maps fading in
  const card = await inPage(`(() => {
    const gl = document.querySelector('.atlas-globe canvas').getContext('webgl2')
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const canvas = gl.canvas
    return (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown') + ' · canvas ' + canvas.width + ' x ' + canvas.height + ' device pixels'
  })()`)
  console.log(`Page: ${page}`)
  console.log(`Graphics: ${card}`)
  console.log(`The page says: ${lightNote}\n`)

  await measure('Nothing moving (5 s)', 'true', 5000)
  await measure('The month playing (8 s)', `document.querySelector('.river-play').click(); true`, 8000)
  await inPage(`document.querySelector('.river-play').click(); true`)
  // A scrub: the hour moves on every frame, the way a drag across the river does.
  await measure(
    'Scrubbing, a new hour every frame (6 s)',
    `(() => {
      const slider = document.querySelector('.river-track input[type=range]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      let hour = 0
      const until = performance.now() + 6000
      const step = () => {
        hour = (hour + 7) % (Number(slider.max) + 1)
        set.call(slider, String(hour))
        slider.dispatchEvent(new Event('input', { bubbles: true }))
        if (performance.now() < until) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      return true
    })()`,
    6500,
  )
  await measure('Flying out to the south pole (1.6 s)', `document.querySelectorAll('.atlas-stops button')[1].click(); true`, 1500)
  await sleep(500)
  await measure('Flying back down to the site (1.6 s)', `document.querySelectorAll('.atlas-stops button')[2].click(); true`, 1500)
  await sleep(500)
  await measure('Sun + Earth layer, the month playing (6 s)', `(() => {
    document.querySelectorAll('.atlas-layers button')[1].click()
    document.querySelector('.river-play').click()
    return true
  })()`, 6000)
} finally {
  socket.close()
  await stop()
}
