// The page opens as two views side by side, one following the Sun and one following Earth; a link
// with `face=sun` or `face=earth` opens one of them, and one with `look=` a single free view.
//
// Looks at the Surface tab (/surface/) in headless Chrome: screenshots of its main states at a desktop
// and a phone size, checks of how it behaves (the address, links, keys, dragging, the motion sensor's
// ways of failing), and frame times while turning and while time plays (docs/VALIDATION.md §13).
//
// Run it from web/, after `npm install`:
//
//   node scripts/surface-shots.mjs --out=../docs/img/surface      screenshots, checks and frame times
//   node scripts/surface-shots.mjs                                checks and frame times
//   node scripts/surface-shots.mjs --only=first-open --out=shots  some screenshots only
//   node scripts/surface-shots.mjs --base=http://localhost:8080   against a server already running
//
// Without --base it starts the Vite dev server itself. Needs Google Chrome (set CHROME to its path if
// it isn't in the usual place). Frame times depend on the graphics card, so the output names the one
// Chrome used. On macOS Chrome is asked for Metal; elsewhere, check that line doesn't say SwiftShader.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const outDir = args.has('out') ? resolve(args.get('out')) : null
if (outDir) mkdirSync(outDir, { recursive: true })
const FRAMES = 300
const TIMEOUT_MS = 30_000

// --size=1024x768 looks at one other window size instead (screenshots only make sense with --only).
const custom = args.get('size')?.split('x').map(Number)
const SIZES = custom
  ? [{ name: args.get('size'), width: custom[0], height: custom[1], scale: 1, mobile: false }]
  : [
      { name: 'desktop', width: 1440, height: 900, scale: 1, mobile: false },
      { name: 'phone', width: 375, height: 812, scale: 3, mobile: true },
    ]
// Connecting Ridge, May 2027: hour 133 has the whole Sun up and Earth in view, hour 270 has the Sun
// behind the land, hour 128 has it half hidden.
const LIMITS = 'limits=14_72_72_1_1&view=3d&mode=learn'
const at = (hour) => `#a=connecting-ridge@2027-05&t=${hour}&${LIMITS}`
const SCENES = [
  { name: 'first-open', hash: '' },
  { name: 'sun-up', hash: at(133) },
  { name: 'sun-half', hash: at(128), keys: ['+', '+', '+', '+', '+', '+'] },
  { name: 'sun-behind-hill', hash: `${at(270)}&face=sun` },
  { name: 'earth-on-the-hills', hash: at(270) },
  { name: 'face-earth', hash: `${at(133)}&face=earth` },
  { name: 'stretch-on', hash: at(133), keys: ['-', '-', '-', '-', '-', '-'], click: 'Stretch heights' },
  { name: 'stretch-off', hash: at(133), keys: ['-', '-', '-', '-', '-', '-'] },
  { name: 'apollo-11', hash: `#a=apollo-11@2028-07&t=200&${LIMITS}` },
  { name: 'custom-link', hash: `#a=-43.3,-11.2@2027-05&t=5&${LIMITS}` },
  { name: 'about-open', hash: at(133), click: 'What this picture is' },
  { name: 'no-graphics', hash: at(133), noGraphics: true },
]

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) =>
    existsSync(path),
  )
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** A connection to Chrome's DevTools protocol: send(method, params, sessionId) resolves with the result. */
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((open, fail) => {
    socket.onopen = open
    socket.onerror = () => fail(new Error('Could not connect to Chrome.'))
  })
  const waiting = new Map()
  let nextId = 1
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) return
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
    close: () => socket.close(),
  }
}

const server = args.has('base') ? null : await createServer({ root: webDir, logLevel: 'warn', server: { port: 0 } })
await server?.listen()
const origin = (args.get('base') ?? server.resolvedUrls.local[0]).replace(/\/$/, '')
const profile = mkdtempSync(join(tmpdir(), 'surface-shots-'))
const browser = spawn(
  chrome,
  ['--headless=new', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
)

/** Open the page at a size, and hand back ways to drive it. */
async function open(cdp, size, hash, { noGraphics = false, slowdown = 1, still = false, before = '' } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => cdp.send(method, params, sessionId)
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  await page('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  if (size.mobile) await page('Emulation.setTouchEmulationEnabled', { enabled: true })
  if (slowdown > 1) await page('Emulation.setCPUThrottlingRate', { rate: slowdown })
  await page('Runtime.enable')
  await page('Page.enable')
  if (still) await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  if (before) await page('Page.addScriptToEvaluateOnNewDocument', { source: before })
  // What a browser with no WebGL looks like to the page.
  if (noGraphics) await page('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.WebGL2RenderingContext' })
  await page('Page.navigate', { url: `${origin}/surface/${hash}` })
  const ready = noGraphics ? "document.querySelector('.sf-flat svg') !== null" : '(window.__surfaceDrawMs?.() ?? 0) > 0'
  const deadline = Date.now() + TIMEOUT_MS
  while (!(await evaluate(ready))) {
    if (Date.now() > deadline) throw new Error(`${size.name} ${hash}: the page did not draw. ${await evaluate('document.body.innerText.slice(0, 300)')}`)
    await sleep(200)
  }
  // Earth's picture and the countdowns arrive a moment after the first frame.
  await sleep(900)
  return {
    evaluate,
    click: (text) => evaluate(`[...document.querySelectorAll('button, summary')].find((el) => el.textContent.includes(${JSON.stringify(text)}))?.click()`),
    key: (key) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)} }))`),
    /** Press, move and let go of the mouse, as a visitor dragging the picture would. */
    async drag(fromX, fromY, toX, toY) {
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 })
      for (let step = 1; step <= 5; step += 1) {
        await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + ((toX - fromX) * step) / 5, y: fromY + ((toY - fromY) * step) / 5, button: 'left' })
      }
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1 })
    },
    async shot(file) {
      const shot = await page('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
    },
    close: () => cdp.send('Target.closeTarget', { targetId }),
  }
}

/**
 * Frame times in the page over FRAMES frames while `drive` runs each frame: the gap from one frame
 * to the next (what the visitor sees) and how long the view's own drawing took on the main thread.
 */
const measure = (drive) => `new Promise((done) => {
  const gaps = []; const draws = []; let last = performance.now()
  const frame = (now) => {
    gaps.push(now - last); last = now; draws.push(window.__surfaceDrawMs())
    ${drive}
    if (gaps.length <= ${FRAMES}) requestAnimationFrame(frame)
    else {
      const stats = (values) => { const sorted = values.slice(1).sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], worst: sorted[sorted.length - 1] } }
      done({ gap: stats(gaps), draw: stats(draws) })
    }
  }
  requestAnimationFrame(frame)
})`
const TURNING = "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))"
const ms = (value) => `${value.toFixed(1)} ms`

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed += 1
}
const FACING = "Number(document.querySelector('.sf-compass-facing strong').textContent.replace('°', ''))"
const MOTION_SAYS = "document.querySelector('.sf-motion-says')?.textContent ?? ''"
const MOTION_BUTTON = 'Look around by moving your phone'
const turn = (from, to) => ((((to - from + 180) % 360) + 360) % 360) - 180

/** How the page behaves on a large screen with a mouse and keys. */
async function deskChecks(cdp, size) {
  const view = at(133)
  let page = await open(cdp, size, view)
  await sleep(600)
  check('the address says both views are up', /&face=both$/.test(await page.evaluate('location.hash')), await page.evaluate('location.hash'))
  const opened = await page.evaluate(`[...document.querySelectorAll('.sf-compass-facing strong')].map((el) => Number(el.textContent.replace('°', '')))`)
  check('it opens as two views, one facing the Sun and one facing Earth', opened.length === 2 && Math.abs(turn(opened[0], 311.4)) <= 1 && Math.abs(turn(opened[1], 132.5)) <= 1, JSON.stringify(opened))
  const tab = await page.evaluate("document.querySelector('a.site-tab[href^=\"/planner/\"]').getAttribute('href')")
  check('the other tabs open on the same site, month, hour and limits', tab === `/planner/${view}`, tab)

  const before = await page.evaluate(FACING)
  await page.key('ArrowRight')
  await sleep(200)
  const afterKey = await page.evaluate(FACING)
  check('the right arrow key turns the view to the right', turn(before, afterKey) > 0, `${before}° to ${afterKey}°`)
  await page.drag(700, 400, 900, 400)
  await sleep(200)
  const afterDrag = await page.evaluate(FACING)
  check('dragging the picture to the right turns the view to the left', turn(afterKey, afterDrag) <= -3, `${afterKey}° to ${afterDrag}°`)
  const other = await page.evaluate(`Number(document.querySelectorAll('.sf-compass-facing strong')[1].textContent.replace('°', ''))`)
  check("steering the Sun's view leaves Earth's facing Earth", Math.abs(turn(other, 132.5)) <= 1, `${other}°`)
  await page.click('Follow the Sun again')
  await sleep(1100)
  const back = await page.evaluate(FACING)
  check('"Follow the Sun again" turns it back to the Sun', Math.abs(turn(back, 311.4)) <= 1 && !(await page.evaluate("document.body.innerText.includes('Follow the Sun again')")), `${back}°`)
  await page.click('Face Earth')
  await sleep(500)
  const one = await page.evaluate("({ panes: document.querySelectorAll('.sf-pane').length, hash: location.hash })")
  check("\"Face Earth\" closes Earth's view, and the address says so", one.panes === 1 && /&face=sun$/.test(one.hash), JSON.stringify(one))
  await page.click('Face Earth')
  await sleep(500)
  const two = await page.evaluate("({ panes: document.querySelectorAll('.sf-pane').length, hash: location.hash })")
  check('and opens it again', two.panes === 2 && /&face=both$/.test(two.hash), JSON.stringify(two))

  await page.evaluate("window.__sameDocument = true; location.hash = '#a=shackleton-rim@2028-03&t=40&limits=10_48_24_1_0&mode=plan&look=90_0_30'")
  await sleep(1800)
  const moved = await page.evaluate(
    `({ site: document.querySelector('select[aria-label="Landing site"]').value, month: document.querySelector('select[aria-label="Month"]').value, time: document.querySelector('.river-time').textContent, facing: ${FACING}, panes: document.querySelectorAll('.sf-pane').length, same: window.__sameDocument === true, tab: document.querySelector('a.site-tab[href^="/planner/"]').getAttribute('href') })`,
  )
  check(
    'a new address from outside moves the view, with no reload, and one that says which way to look opens one free view',
    moved.site === 'shackleton-rim' && moved.month === '2028-03' && moved.time.startsWith('2 March 2028') && moved.facing === 90 && moved.panes === 1 && moved.same,
    JSON.stringify(moved),
  )
  check('and the limits in it are kept for the other tabs', moved.tab.includes('limits=10_48_24_1_0'), moved.tab)
  await page.close()

  page = await open(cdp, size, view, { still: true })
  await page.click('Face the Sun')
  await sleep(120)
  const facing = await page.evaluate(FACING)
  check("with reduced motion, Earth's view left alone faces Earth at once", Math.abs(turn(facing, 132.51)) <= 1, `${facing}°`)
  await page.close()
}

/** The ways looking around with the phone can go, none of which may break the page. */
async function motionChecks(cdp, size) {
  // The phone steers one view: the button is offered when one is up, not two.
  const view = `${at(133)}&face=sun`
  const both = await open(cdp, size, at(133))
  check('motion: not offered while two views are up', !(await both.evaluate(`document.body.innerText.includes(${JSON.stringify(MOTION_BUTTON)})`)))
  await both.close()
  const stillWorks = async (page) => {
    const before = await page.evaluate(FACING)
    await page.key('ArrowRight')
    await sleep(200)
    return turn(before, await page.evaluate(FACING)) > 0
  }
  const cases = [
    { name: 'a device that sends no readings (this one)', before: '', says: 'not reporting its motion' },
    { name: 'a visitor who turns motion access down', before: "DeviceOrientationEvent.requestPermission = async () => 'denied'", says: 'turned down' },
    { name: 'a browser that will not ask', before: "DeviceOrientationEvent.requestPermission = () => Promise.reject(new Error('NotAllowedError'))", says: 'turned down' },
    { name: 'a browser with no motion sensor at all', before: 'delete window.DeviceOrientationEvent', says: 'no motion sensor' },
  ]
  for (const { name, before, says } of cases) {
    const page = await open(cdp, size, view, { before })
    await page.click(MOTION_BUTTON)
    await sleep(2000)
    const said = await page.evaluate(MOTION_SAYS)
    check(`motion, ${name}: the page says so and still turns by hand`, said.includes(says) && (await stillWorks(page)), said)
    await page.close()
  }

  // A sensor that works, played by hand: readings as a phone held upright and turned 30° to the right would send.
  const page = await open(cdp, size, view, { before: "DeviceOrientationEvent.requestPermission = async () => 'granted'" })
  const start = await page.evaluate(FACING)
  await page.click(MOTION_BUTTON)
  const send = (alpha, beta) => `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: ${alpha}, beta: ${beta}, gamma: 0 }))`
  await page.evaluate(send(0, 90))
  for (let i = 0; i < 40; i += 1) await page.evaluate(send(330, 95))
  await sleep(300)
  const turned = await page.evaluate(FACING)
  const said = await page.evaluate(MOTION_SAYS)
  check('motion, readings played by hand: turning the phone 30° right turns the view 30° right', Math.abs(turn(start, turned) - 30) <= 1 && said.includes('Turn with your phone'), `${start}° to ${turned}°; "${said}"`)
  await page.click('Stop following the phone')
  await sleep(200)
  check('motion: stopping hands the view back', (await page.evaluate(MOTION_SAYS)) === '' && (await stillWorks(page)))
  await page.close()
}

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

  for (const size of SIZES) {
    if (outDir && !args.has('frames-only')) {
      for (const scene of SCENES) {
        if (args.has('only') && !args.get('only').split(',').includes(scene.name)) continue
        const page = await open(cdp, size, scene.hash, scene)
        for (const key of scene.keys ?? []) await page.key(key)
        if (scene.click) await page.click(scene.click)
        await sleep(1100)
        const overflow = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        await page.shot(join(outDir, `${size.name}-${scene.name}.png`))
        console.log(`${size.name} ${scene.name}: saved${overflow > 0 ? `; SIDEWAYS SCROLL of ${overflow} px` : ''}`)
        await page.close()
      }
    }
    if (args.has('only')) continue
    if (!args.has('frames-only')) await (size.mobile ? motionChecks : deskChecks)(cdp, size)
    // Once as this computer runs it, and once with the processor slowed, as a stand-in for a phone's.
    for (const slowdown of size.mobile ? [1, 4] : [1]) {
      const page = await open(cdp, size, at(133), { slowdown })
      const gpu = await page.evaluate(
        "(() => { const gl = document.createElement('canvas').getContext('webgl2'); const info = gl.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) })()",
      )
      const turning = await page.evaluate(measure(TURNING))
      await page.click('Follow the Sun again')
      await sleep(900)
      await page.evaluate("document.querySelector('.river-play').click()")
      const playing = await page.evaluate(measure(''))
      console.log(`\n${size.name} (${size.width} × ${size.height}, pixel ratio ${size.scale})${slowdown > 1 ? `, processor slowed ${slowdown} times` : ''}, ${FRAMES} frames each. Graphics: ${gpu}`)
      console.log(`  turning:      frame to frame median ${ms(turning.gap.median)}, worst ${ms(turning.gap.worst)}; drawing median ${ms(turning.draw.median)}, worst ${ms(turning.draw.worst)}`)
      console.log(`  time playing: frame to frame median ${ms(playing.gap.median)}, worst ${ms(playing.gap.worst)}; drawing median ${ms(playing.draw.median)}, worst ${ms(playing.draw.worst)}\n`)
      await page.close()
    }
  }
} finally {
  cdp?.close()
  browser.kill()
  await server?.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
if (failed) console.log(`${failed} check(s) failed`)
process.exit(failed ? 1 : 0)
