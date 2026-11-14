// Records the narrated videos of Sightline from the real site, in headless Chrome.
//
// Run it from web/ (README.md in this folder says what it needs and what each file is):
//
//   node scripts/video/record.mjs                      the tutorial, from https://lunarsightline.com
//   node scripts/video/record.mjs --cut=pitch          the 30-second demo for the Space Apps submission
//   node scripts/video/record.mjs --stills             a rehearsal: one picture a second, no video
//   node scripts/video/record.mjs --words              only speak the words and print how long they take
//   node scripts/video/record.mjs --check=file.mp4     only measure a finished file
//   node scripts/video/record.mjs --base=http://localhost:5173 --tour=path/to/tour.json --out=dir --fps=30
//
// The tutorial's steps and words come from the tour's own file (src/sightline/tour.json), so the
// video says what the tour on the site says. tutorial.json, beside this file, holds what the videos
// add: where the pointer and the camera go, the demo's own words, the cards, the pauses, and the
// line that says the voice is AI-generated.
//
// The voice is Google Cloud Text-to-Speech, asked from this machine (never through the site's own
// voice route, which has a daily allowance for visitors). Each clip is kept in cache/video/voice, so
// a second run with the same words asks for nothing.
//
// Nothing the page sends to Scout's chat or to the site's voice route leaves the browser during a
// recording unless --ask is given.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const webDir = resolve(here, '../..')
const args = new Map(process.argv.slice(2).map((arg) => { const [name, ...rest] = arg.replace(/^--/, '').split('='); return [name, rest.join('=')] }))
const WIDTH = 1920
const HEIGHT = 1080
// The picture is the site above a band. The band holds the words being said, large enough to read on
// a phone, and under them the line saying the voice is AI-generated, for the whole video. Nothing of
// the video's own lies over the site except the pointer, the rings and the two cards.
const BAND = 128
const VIEW = HEIGHT - BAND
// The site is drawn at twice its size, as on a laptop's dense screen, so the camera can move in on a
// control and the picture stays sharp.
const DENSITY = 2
const FPS = Number(args.get('fps') || 60)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'

if (args.has('check')) {
  const report = measure(resolve(args.get('check')), args.get('longest') ? Number(args.get('longest')) : null, null)
  console.log(JSON.stringify(report, null, 1))
  process.exit(report.ok ? 0 : 1)
}

const cutName = args.get('cut') || 'full'
const base = (args.get('base') || 'https://lunarsightline.com').replace(/\/$/, '')
const outDir = resolve(args.get('out') || join(webDir, '../cache/video', cutName))
const voiceDir = resolve(join(webDir, '../cache/video/voice'))
mkdirSync(outDir, { recursive: true })
mkdirSync(voiceDir, { recursive: true })
const directions = JSON.parse(readFileSync(join(here, 'tutorial.json'), 'utf8'))
const cut = directions.cuts[cutName]
if (!cut) throw new Error(`No cut called "${cutName}" in tutorial.json.`)
// The tutorial follows the tour's file; a cut with words of its own (the demo) does not need it.
const tour = cut.script ? null : JSON.parse(readFileSync(resolve(args.get('tour') || join(webDir, 'src/sightline/tour.json')), 'utf8'))
const voiceName = args.get('voice') || /\(([a-z]{2}-[A-Z]{2}-[^)]+)\)/.exec(tour?.voice?.from ?? '')?.[1] || directions.voice
const disclosure = directions.disclosure

// ---- The words ----

const sentences = (words) => words.split(/(?<=[.?!])\s+/)
/** The steps this cut shows, each with the words it says and what the pointer and the camera do meanwhile. */
const steps = cut.script
  ? cut.script.map((beat) => ({ id: beat.id, title: beat.title ?? beat.id, targets: beat.targets ?? [], lines: sentences(beat.say), say: beat.say, acts: beat.acts ?? [] }))
  : tour.steps.map((step) => ({ id: step.id, title: step.title, targets: step.targets ?? [], lines: sentences(step.say), say: step.say, acts: directions.acts[step.id] ?? [] }))

// ---- The voice ----

/** A clip's samples (16-bit, one channel) out of the WAV the service returns. */
function readWav(bytes) {
  let at = 12
  let rate = 24000
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('latin1', at, at + 4)
    const size = bytes.readUInt32LE(at + 4)
    if (name === 'fmt ') {
      if (bytes.readUInt16LE(at + 10) !== 1 || bytes.readUInt16LE(at + 22) !== 16) throw new Error('The voice clip is not 16-bit, one channel.')
      rate = bytes.readUInt32LE(at + 12)
    }
    if (name === 'data') {
      const end = Math.min(bytes.length, at + 8 + size)
      return { rate, samples: new Int16Array(bytes.buffer.slice(bytes.byteOffset + at + 8, bytes.byteOffset + end - ((end - at - 8) % 2))) }
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('The voice clip has no sound in it.')
}
function writeWav(path, samples, rate) {
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + samples.length * 2, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(samples.length * 2, 40)
  writeFileSync(path, Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]))
}

let asked = 0
let token = null
/** One step's words, spoken: from the cache, or asked of Cloud Text-to-Speech and kept. */
async function speak(words) {
  const file = join(voiceDir, `${createHash('sha256').update(`${voiceName}\n${cut.rate ?? 1}\n${words}`).digest('hex').slice(0, 20)}.wav`)
  if (!existsSync(file)) {
    token ??= execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
    // A developer's token belongs to no project, so the call names the one that pays for it.
    const project = args.get('project') || process.env.GOOGLE_CLOUD_PROJECT || execFileSync('gcloud', ['config', 'get-value', 'project'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!project) throw new Error('Text-to-Speech needs a Google Cloud project to bill: pass --project=<id> or set GOOGLE_CLOUD_PROJECT.')
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-goog-user-project': project },
      body: JSON.stringify({
        input: { text: words },
        voice: { languageCode: voiceName.split('-').slice(0, 2).join('-'), name: voiceName },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, ...(cut.rate ? { speakingRate: cut.rate } : {}) },
      }),
    })
    if (!response.ok) throw new Error(`Text-to-Speech: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
    const { audioContent } = await response.json()
    if (!audioContent) throw new Error('Text-to-Speech: no audio in the answer.')
    writeFileSync(file, Buffer.from(audioContent, 'base64'))
    asked += words.length
  }
  const { rate, samples } = readWav(readFileSync(file))
  // Trim the silence the service leaves at either end, so the gaps between steps are the ones set here.
  const loud = (index) => Math.abs(samples[index]) > 220
  let from = 0
  let to = samples.length
  while (from < to && !loud(from)) from += 1
  while (to > from && !loud(to - 1)) to -= 1
  const pad = Math.round(rate * 0.03)
  const clip = samples.slice(Math.max(0, from - pad), Math.min(samples.length, to + pad))
  return { rate, samples: clip, seconds: clip.length / rate }
}

/** Where each sentence of a clip ends: the longest quiet stretch near where the letters say it should be. */
function sentenceEnds(clip, lines) {
  if (lines.length === 1) return [clip.seconds]
  const window = Math.round(clip.rate * 0.01)
  const quiet = []
  let run = null
  for (let at = 0; at + window <= clip.samples.length; at += window) {
    let sum = 0
    for (let index = at; index < at + window; index += 1) sum += clip.samples[index] * clip.samples[index]
    const silent = Math.sqrt(sum / window) < 260
    if (silent && run === null) run = at
    if (!silent && run !== null) {
      if (at - run >= clip.rate * 0.12) quiet.push({ from: run / clip.rate, to: at / clip.rate })
      run = null
    }
  }
  const letters = lines.reduce((sum, line) => sum + line.length, 0)
  const ends = []
  let read = 0
  for (const line of lines.slice(0, -1)) {
    read += line.length
    const guess = (read / letters) * clip.seconds
    const near = quiet.filter((gap) => Math.abs((gap.from + gap.to) / 2 - guess) < Math.max(1.2, clip.seconds * 0.2) && gap.from > (ends.at(-1) ?? 0) + 0.4)
    const best = near.sort((a, b) => b.to - b.from - (a.to - a.from))[0]
    ends.push(best ? (best.from + best.to) / 2 : guess)
  }
  return [...ends, clip.seconds]
}

// ---- The timeline ----

const pace = { lead: 1, before: 0.4, after: 0.6, tail: 1.5, fadeIn: 0.4, fadeOut: 0.5, ...directions.pace, ...cut.pace }
let clock = pace.lead
for (const step of steps) {
  step.clip = await speak(step.say)
  step.start = clock
  step.speechStart = step.start + pace.before
  step.speechEnd = step.speechStart + step.clip.seconds
  step.end = step.speechEnd + pace.after
  step.ends = sentenceEnds(step.clip, step.lines)
  clock = step.end
}
let length = clock + pace.tail
if (cut.length) {
  if (length > cut.length + 1e-6) {
    console.error(`This cut must run ${cut.length} s, and its words and pauses take ${length.toFixed(2)} s:`)
    for (const step of steps) console.error(`  ${step.id.padEnd(9)} ${step.clip.seconds.toFixed(2)} s  ${step.say}`)
    process.exit(1)
  }
  length = cut.length
}
const frameCount = Math.round(length * FPS)
length = frameCount / FPS
const spoken = steps.reduce((sum, step) => sum + step.clip.seconds, 0)
const wordCount = steps.reduce((sum, step) => sum + step.say.split(/\s+/).length, 0)
console.log(`${cutName}: ${steps.length} steps, ${length.toFixed(2)} s at ${FPS} frames a second (${frameCount} frames); ${spoken.toFixed(2)} s of speech, ${wordCount} words; voice ${voiceName}${cut.rate ? ` at ${cut.rate} times its pace` : ''}; ${asked} characters asked of Text-to-Speech in this run`)
for (const step of steps) console.log(`  ${step.start.toFixed(2).padStart(6)}  ${step.id.padEnd(9)} speech ${step.clip.seconds.toFixed(2)} s, to ${step.speechEnd.toFixed(2)}`)
if (args.has('words')) process.exit(0)

const span = (step) => step.end - step.start
// What happens with no words being said: before the first step (the tutorial starts the tour there)
// and after the last. Their acts' "at" is a fraction of that stretch, as in a step.
const stretches = [{ id: 'intro', start: 0, end: pace.lead, targets: [], acts: cut.intro ?? [] }, ...steps, { id: 'outro', start: clock, end: length, targets: [], acts: cut.outro ?? [] }]
/** The cards: the one that opens the video, the one that closes it, and any a step's acts put up. */
const cards = []
if (cut.opening) cards.push({ ...directions.cards.open, from: -1, to: cut.opening, fadeIn: 0, fadeOut: 0.6 })
if (cut.closing) cards.push({ ...directions.cards.close, from: length - cut.closing, to: length + 1, fadeIn: 0.6, fadeOut: 0 })
for (const step of stretches) for (const act of step.acts.filter((one) => one.card)) cards.push({ ...directions.cards[act.card], from: step.start + act.at * span(step), to: length + 1, fadeIn: act.over ?? 0.5, fadeOut: 0 })

// ---- The sound, the captions and the list of steps ----

const rate = steps[0].clip.rate
const track = new Int16Array(Math.round(length * rate))
for (const step of steps) track.set(step.clip.samples.subarray(0, Math.max(0, track.length - Math.round(step.speechStart * rate))), Math.round(step.speechStart * rate))
let peak = 1
for (const sample of track) peak = Math.max(peak, Math.abs(sample))
const gain = (32767 * 10 ** (-1 / 20)) / peak
for (let index = 0; index < track.length; index += 1) track[index] = Math.round(track[index] * gain)
const soundFile = join(outDir, 'narration.wav')
writeWav(soundFile, track, rate)

const stamp = (seconds) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
const cues = steps.flatMap((step) => step.lines.map((line, index) => ({ from: step.speechStart + (index === 0 ? 0 : step.ends[index - 1]), to: step.speechStart + step.ends[index], text: line })))
const captionsFile = join(outDir, `${cut.file}.vtt`)
writeFileSync(captionsFile, `WEBVTT\n\nNOTE ${disclosure}\n\n${cues.map((cue) => `${stamp(cue.from)} --> ${stamp(cue.to)}\n${cue.text}`).join('\n\n')}\n`)

// ---- Chrome ----

const chrome = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
if (!chrome) throw new Error('Google Chrome not found. Set CHROME to its path.')
const profile = mkdtempSync(join(tmpdir(), 'sightline-video-'))
const browser = spawn(chrome, ['--headless=new', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--window-size=${WIDTH},${VIEW}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const portFile = join(profile, 'DevToolsActivePort')
for (let tries = 0; !existsSync(portFile); tries += 1) {
  if (tries > 100) throw new Error('Chrome did not start.')
  await sleep(100)
}
const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
await new Promise((open, fail) => { socket.onopen = open; socket.onerror = () => fail(new Error('Could not connect to Chrome.')) })
const waiting = new Map()
const pageErrors = []
let nextId = 1
let reloads = 0
let recordedPage = null
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Page.frameNavigated' && message.sessionId === recordedPage && !message.params.frame.parentId) reloads += 1
  if (message.id === undefined) return
  const { done, fail } = waiting.get(message.id)
  waiting.delete(message.id)
  if (message.error) fail(new Error(message.error.message))
  else done(message.result)
}
const send = (method, params = {}, sessionId = undefined) => {
  const id = nextId++
  socket.send(JSON.stringify({ id, method, params, sessionId }))
  return new Promise((done, fail) => waiting.set(id, { done, fail }))
}
const { browserContextId } = await send('Target.createBrowserContext')
const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
recordedPage = sessionId
const page = (method, params) => send(method, params, sessionId)
async function evaluate(expression) {
  const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

let failure = null
let posterAt = 0
const stillsOnly = args.has('stills')
const lateBy = []
try {
  // The band under the site, drawn once for each caption by the same browser, so the video needs no
  // font of its own: the words being said, and under them the line about the voice and the address.
  const bands = new Map()
  {
    const made = await send('Target.createTarget', { url: 'about:blank', browserContextId })
    const attached = await send('Target.attachToTarget', { targetId: made.targetId, flatten: true })
    const band = (method, params) => send(method, params, attached.sessionId)
    const safe = (words) => words.replace(/[&<>]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[letter])
    await band('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: BAND, deviceScaleFactor: 1, mobile: false })
    await band('Page.enable')
    for (const words of ['', ...new Set(cues.map((cue) => cue.text))]) {
      const html = `<body style="margin:0;height:${BAND}px;overflow:hidden;background:#05060a;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.14)">
        <div id="words" style="position:absolute;left:40px;right:40px;top:8px;font-weight:600;font-size:34px;line-height:42px;text-align:center;text-wrap:balance">${safe(words)}</div>
        <div style="position:absolute;left:16px;right:16px;bottom:7px;display:flex;justify-content:space-between;font-weight:500;font-size:15px;line-height:18px;letter-spacing:.01em;color:rgba(255,255,255,.72)"><span>${safe(disclosure)}</span><span>${safe(directions.band.right)}</span></div>
        <script>const words = document.getElementById('words'); document.title = String(words.offsetHeight); words.style.top = (8 + Math.max(0, (84 - words.offsetHeight) / 2)) + 'px'</script></body>`
      await band('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` })
      await sleep(250)
      const tall = await send('Runtime.evaluate', { expression: 'Number(document.title)', returnByValue: true }, attached.sessionId)
      if (!(tall.result.value <= 84)) throw new Error(`These words do not fit the band in two lines: ${words}`)
      bands.set(words, Buffer.from((await band('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    }
    await send('Target.closeTarget', { targetId: made.targetId })
  }

  await page('Page.enable')
  await page('Runtime.enable')
  await page('Network.enable')
  if (!args.has('ask')) await page('Network.setBlockedURLs', { urls: ['*/api/chat', '*/api/ask', '*/api/speak*'] })
  await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: VIEW, deviceScaleFactor: DENSITY, mobile: false })
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await page('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(join(here, 'page.js'), 'utf8') })
  await page('Page.navigate', { url: `${base}${cut.open ?? directions.open}` })
  // The page as a visitor gets it: wait for the Moon and whatever it loads first, with the clock still real.
  for (let tries = 0; ; tries += 1) {
    if (await evaluate(directions.ready).catch(() => false)) break
    if (tries > 150) throw new Error('The page did not show the Moon within 30 s.')
    await sleep(200)
  }
  await sleep((cut.settle ?? directions.settle ?? 4) * 1000)
  // What a cut does before the recording starts (the demo opens a link with four scenarios, then Watch).
  for (const act of cut.prepare ?? []) {
    if (act.click) {
      const box = await evaluate(`window.__video.box(${JSON.stringify(act.click)})`)
      if (!box) throw new Error(`Before recording: nothing matches ${JSON.stringify(act.click)}.`)
      const at = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 })
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 })
    }
    await sleep((act.wait ?? 1) * 1000)
  }
  const firstLoads = reloads
  await evaluate('window.__video.hold()')

  // ---- What the video does, frame by frame ----

  let frame = 0
  let pointer = [...directions.pointerStart]
  let tap = null
  const rings = stretches.flatMap((step) =>
    step.acts
      .filter((act) => act.ring)
      .map((act) => ({ spec: act.ring === 'targets' ? step.targets : act.ring, from: step.start + act.at * span(step), to: step.start + (act.until ?? 0.97) * span(step), pad: act.pad, round: act.round })),
  )
  // The camera: the part of the site in the picture. Each move starts at its time whatever the pointer is doing.
  const whole = { x: 0, y: 0, w: WIDTH, h: VIEW }
  const moves = stretches
    .flatMap((step) => step.acts.filter((act) => act.zoom).map((act) => ({ ...act, time: step.start + act.at * span(step), step: step.id })))
    .sort((a, b) => a.time - b.time)
  // A cut may open with the camera already on a part of the screen (the demo opens on the Moon).
  let camera = cut.camera ? { x: cut.camera[0] * WIDTH, y: cut.camera[1] * VIEW, w: cut.camera[2] * WIDTH, h: cut.camera[2] * VIEW } : whole
  let move = null
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
  /** The part of the site a camera move ends on: the thing it names, with room round it, never closer than `max`. */
  async function aim(act) {
    if (act.zoom === 'out') return whole
    // A part of the screen given outright: its left and top edges and its width, as fractions of the screen.
    if (act.zoom === 'frame') return { x: act.frame[0] * WIDTH, y: act.frame[1] * VIEW, w: act.frame[2] * WIDTH, h: act.frame[2] * VIEW }
    const box = await evaluate(`window.__video.box(${JSON.stringify(act.zoom)})`)
    if (!box) {
      if (act.optional) return camera
      throw new Error(`Nothing on the page matches ${JSON.stringify(act.zoom)} (camera, in "${act.step}").`)
    }
    const pad = act.pad ?? 40
    const closeness = Math.max(1, Math.min(act.max ?? 2, WIDTH / (box.w + 2 * pad), VIEW / (box.h + 2 * pad)))
    const w = WIDTH / closeness
    const h = VIEW / closeness
    const place = act.place ?? [0.5, 0.5]
    return { x: Math.min(WIDTH - w, Math.max(0, box.x + box.w * place[0] - w / 2)), y: Math.min(VIEW - h, Math.max(0, box.y + box.h * place[1] - h / 2)), w, h }
  }
  function cameraAt(time) {
    if (!move) return camera
    const t = ease(Math.min(1, (time - move.start) / move.seconds))
    // Closeness moves evenly on a log scale, so moving in and moving out feel the same.
    const w = Math.exp(Math.log(move.from.w) + (Math.log(move.to.w) - Math.log(move.from.w)) * t)
    const part = Math.abs(move.from.w - move.to.w) < 1e-6 ? t : (move.from.w - w) / (move.from.w - move.to.w)
    return { x: move.from.x + (move.to.x - move.from.x) * part, y: move.from.y + (move.to.y - move.from.y) * part, w, h: (w * VIEW) / WIDTH }
  }

  const encoder = stillsOnly
    ? null
    : spawn(
        ffmpeg,
        ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', 'pipe:3', '-i', soundFile,
          '-filter_complex', `[0:v]scale=${WIDTH}:${VIEW}:flags=bicubic,format=rgb24[site];[1:v]format=rgb24[band];[site][band]vstack=inputs=2,scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p,fade=t=in:st=0:d=${pace.fadeIn},fade=t=out:st=${(length - pace.fadeOut).toFixed(3)}:d=${pace.fadeOut}[picture]`,
          '-map', '[picture]', '-map', '2:a',
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
          '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-metadata:s:a:0', 'language=eng',
          '-metadata', `title=${cut.title}`, '-metadata', `comment=${disclosure}. Recorded from ${base}.`,
          '-t', length.toFixed(3), '-movflags', '+faststart', join(outDir, `${cut.file}.mp4`)],
        { stdio: ['pipe', 'inherit', 'inherit', 'pipe'] },
      )
  const encoded = encoder ? new Promise((done, fail) => encoder.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg ended with ${code}.`))))) : null
  // The band's frames are known before the first picture is taken (which words are up at which
  // moment), so they are all handed over now. ffmpeg reads ahead on each input before it starts, and
  // feeding the two in step would leave each waiting for the other.
  if (encoder) {
    for (let index = 0; index < frameCount; index += 1) {
      const cue = cues.find((one) => index / FPS >= one.from && index / FPS < one.to)
      encoder.stdio[3].write(bands.get(cue?.text ?? ''))
    }
    encoder.stdio[3].end()
  }
  const put = (stream, bytes) => new Promise((done) => (stream.write(bytes) ? done() : stream.once('drain', done)))
  posterAt = Math.round((() => { const step = steps.find((one) => one.id === cut.poster?.step) ?? steps[0]; return cut.poster?.time ?? step.start + (cut.poster?.at ?? 0.5) * span(step) })() * FPS)

  /** Takes the next frame of the video: the page's clock moves on by one frame's time. */
  async function take() {
    if (frame >= frameCount) return
    const time = frame / FPS
    while (moves.length && moves[0].time <= time + 1e-9) {
      const act = moves.shift()
      const from = cameraAt(time)
      move = { from, to: await aim(act), start: time, seconds: act.over ?? 1.2 }
      camera = move.to
    }
    const view = cameraAt(time)
    if (move && time >= move.start + move.seconds) move = null
    const shown = rings.filter((ring) => time >= ring.from && time <= ring.to).map((ring) => ({ spec: ring.spec, pad: ring.pad, round: ring.round, alpha: Math.min(1, (time - ring.from) / 0.25, (ring.to - time) / 0.25).toFixed(3) }))
    const up = cards.find((card) => time >= card.from && time < card.to)
    const card = up ? { title: up.title, lines: up.lines, alpha: Math.max(0, Math.min(1, up.fadeIn ? (time - up.from) / up.fadeIn : 1, up.fadeOut ? (up.to - time) / up.fadeOut : 1)).toFixed(3) } : null
    const state = { ms: 1000 / FPS, pointer, rings: shown, card, tap: tap && time - tap.at < 0.5 ? { x: tap.x, y: tap.y, age: (time - tap.at) / 0.5 } : null }
    await evaluate(`window.__video.frame(${JSON.stringify(state)})`)
    const keep = !stillsOnly || frame % FPS === 0
    if (keep) {
      const shot = Buffer.from((await page('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: view.x, y: view.y, width: view.w, height: view.h, scale: WIDTH / view.w / DENSITY } })).data, 'base64')
      if (stillsOnly) writeFileSync(join(outDir, `still-${String(frame / FPS).padStart(3, '0')}.jpg`), shot)
      if (encoder) {
        await put(encoder.stdin, shot)
      }
    }
    frame += 1
    if (frame % (FPS * 10) === 0) console.log(`  ${frame / FPS} s recorded`)
  }
  const until = async (time) => { while (frame / FPS < time - 1e-9 && frame < frameCount) await take() }
  const moveMouse = (buttons = 0) => page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer[0], y: pointer[1], button: buttons ? 'left' : 'none', buttons })
  /** Glides the pointer to a place over some seconds, as real mouse movement the page can feel. */
  async function glide(to, seconds, buttons = 0) {
    const from = pointer
    const count = Math.max(1, Math.round(seconds * FPS))
    for (let index = 1; index <= count; index += 1) {
      const t = ease(index / count)
      pointer = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
      await moveMouse(buttons)
      await take()
    }
  }
  /** The middle of what a direction names (or the place in it the direction gives, as fractions of its box). */
  async function placeOf(spec, place = [0.5, 0.5], needed = true) {
    const box = await evaluate(`window.__video.box(${JSON.stringify(spec)})`)
    if (!box) {
      if (needed) throw new Error(`Nothing on the page matches ${JSON.stringify(spec)}.`)
      return null
    }
    return { box, at: [box.x + box.w * place[0], box.y + box.h * place[1]] }
  }
  const press = async () => {
    await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointer[0], y: pointer[1], button: 'left', buttons: 1, clickCount: 1 })
    tap = { x: pointer[0], y: pointer[1], at: frame / FPS }
  }
  const release = () => page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer[0], y: pointer[1], button: 'left', buttons: 0, clickCount: 1 })
  const hold = async (seconds) => until(frame / FPS + seconds)

  /** The address a step's plan has: the tour's own scenario, as the page writes it in its address. */
  const scenarioHash = () => {
    const [date, hour] = tour.scenario.landing.split('T')
    const hours = (Number(date.slice(8, 10)) - 1) * 24 + Number(hour.slice(0, 2))
    return `#a=${tour.scenario.site}@${date.slice(0, 7)}&t=${hours}&mode=plan`
  }

  async function perform(act, step) {
    const over = act.over ?? 0.7
    if (act.point || act.click) {
      const target = await placeOf(act.point ?? act.click, act.place, act.optional !== true)
      if (!target) return console.log(`  (skipped: nothing matches ${JSON.stringify(act.point ?? act.click)} in "${step.id}")`)
      await glide(target.at, over)
      if (act.click) {
        // Aim again: the control may have moved while the pointer travelled.
        const again = await placeOf(act.click, act.place, false)
        if (again) pointer = again.at
        await moveMouse()
        await hold(0.05)
        await press()
        await hold(0.07)
        await release()
      }
    } else if (act.slide) {
      // A slider: take its handle and carry it to where `to` says, as a fraction of its track.
      const { box } = await placeOf(act.slide)
      const inset = act.inset ?? 8
      const along = (fraction) => [box.x + inset + fraction * (box.w - 2 * inset), box.y + box.h / 2]
      const start = box.range ? (box.range.value - box.range.min) / (box.range.max - box.range.min) : 0.5
      await glide(along(start), act.reach ?? 0.6)
      await press()
      await hold(0.07)
      await glide(along(act.to), over, 1)
      await hold(0.07)
      await release()
    } else if (act.wheel) {
      // The wheel, turned over a place for some seconds: the page's own way of moving in on the Moon.
      const target = await placeOf(act.wheel, act.place)
      await glide(target.at, act.reach ?? 0.5)
      const count = Math.max(1, Math.round(over * FPS))
      for (let index = 0; index < count; index += 1) {
        await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pointer[0], y: pointer[1], deltaX: 0, deltaY: act.by / count })
        await take()
      }
    } else if (act.go) {
      await evaluate(`(location.hash = ${JSON.stringify(act.go === 'scenario' ? scenarioHash() : act.go)}, true)`)
    } else if (act.type) {
      const target = await placeOf(act.type)
      await glide(target.at, act.reach ?? 0.5)
      await press()
      await hold(0.07)
      await release()
      const each = over / act.text.length
      const begun = frame / FPS
      for (const [index, letter] of [...act.text].entries()) {
        await page('Input.insertText', { text: letter })
        await until(begun + (index + 1) * each)
      }
      if (act.enter) await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    } else if (act.key) {
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key: act.key, code: act.key })
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: act.key, code: act.key })
    } else if (act.rest) {
      await glide([act.rest[0] * WIDTH, act.rest[1] * VIEW], over)
    }
  }

  await moveMouse()
  for (const step of stretches) {
    for (const act of step.acts.filter((one) => !one.ring && !one.zoom && !one.card)) {
      const due = step.start + act.at * span(step)
      await until(due)
      if (frame / FPS - due > 0.25) lateBy.push(`${step.id}: ${JSON.stringify(act).slice(0, 60)} began ${(frame / FPS - due).toFixed(2)} s late`)
      await perform(act, step)
    }
  }
  await until(length)
  if (encoder) {
    encoder.stdin.end()
    await encoded
  }
  if (reloads !== firstLoads) throw new Error('The page loaded itself again during the recording, so the video is not one take.')
} catch (error) {
  failure = error
} finally {
  socket.close()
  browser.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
if (failure) {
  console.error(failure.message)
  process.exit(1)
}
for (const line of lateBy) console.log(`late: ${line}`)
if (pageErrors.length) console.log(`The page reported ${pageErrors.length} error(s): ${[...new Set(pageErrors)].slice(0, 3).join(' | ').slice(0, 400)}`)
if (stillsOnly) {
  console.log(`Rehearsal stills are in ${outDir}`)
  process.exit(0)
}

// ---- The poster, the list of steps, and a look at the finished file ----

const video = join(outDir, `${cut.file}.mp4`)
if (cut.poster) execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', (posterAt / FPS).toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '3', join(outDir, `${cut.file}-poster.jpg`)])
const report = measure(video, cut.length ? cut.length + (cut.slack ?? 0.5) : null, FPS)
const status = await fetch(`${base}/api/status`).then((response) => (response.ok ? response.json() : null)).catch(() => null)
writeFileSync(
  join(outDir, `${cut.file}.json`),
  `${JSON.stringify({
    name: cut.title,
    file: `${cut.file}.mp4`,
    captions: `${cut.file}.vtt`,
    poster: cut.poster ? `${cut.file}-poster.jpg` : null,
    seconds: report.seconds,
    width: report.width,
    height: report.height,
    framesASecond: report.framesASecond,
    recorded: new Date().toISOString(),
    recordedFrom: base,
    siteRevision: status?.revision ?? null,
    voice: { name: voiceName, from: 'Google Cloud Text-to-Speech', disclosure },
    steps: steps.map((step) => ({ id: step.id, title: step.title, say: step.say, start: Number(step.start.toFixed(3)), speech: [Number(step.speechStart.toFixed(3)), Number(step.speechEnd.toFixed(3))], end: Number(step.end.toFixed(3)) })),
  }, null, 1)}\n`,
)
console.log(JSON.stringify(report, null, 1))
console.log(`Written to ${outDir}`)
process.exit(report.ok ? 0 : 1)

/**
 * Measures a finished file: its real length, size and frame rate, and how its picture moves. Each
 * frame is read small and grey and compared with the one before. A frame that repeats the one
 * before while the frames either side of the pair are moving is a stall; a change many times the
 * changes round it is a jump (a press that swaps the view is one, and is expected there).
 */
function measure(file, longest, rateWanted) {
  const probe = JSON.parse(execFileSync(process.env.FFPROBE ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,duration', '-of', 'json', file], { encoding: 'utf8' }))
  const picture = probe.streams.find((stream) => stream.codec_type === 'video')
  const [up, down] = picture.avg_frame_rate.split('/').map(Number)
  const w = 192
  const h = 108
  const raw = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 })
  const count = Math.floor(raw.length / (w * h))
  const change = [0]
  for (let index = 1; index < count; index += 1) {
    let sum = 0
    const a = (index - 1) * w * h
    const b = index * w * h
    for (let at = 0; at < w * h; at += 1) sum += Math.abs(raw[b + at] - raw[a + at])
    change.push(sum / (w * h))
  }
  const stalls = []
  const jumps = []
  for (let index = 2; index < count - 2; index += 1) {
    const around = [change[index - 2], change[index - 1], change[index + 1], change[index + 2]]
    const least = Math.min(...around)
    const most = Math.max(...around)
    if (change[index] < 0.002 && least > 0.05) stalls.push(Number((index / (up / down)).toFixed(2)))
    if (change[index] > 4 && change[index] > 8 * Math.max(most, 0.05)) jumps.push(Number((index / (up / down)).toFixed(2)))
  }
  const seconds = Number(probe.format.duration)
  const streams = probe.streams.map((stream) => `${stream.codec_type} ${stream.codec_name} ${Number(stream.duration ?? 0).toFixed(3)} s`)
  const ok = picture.width === WIDTH && picture.height === HEIGHT && (rateWanted === null || Math.abs(up / down - rateWanted) < 0.01) && stalls.length === 0 && (longest === null || seconds <= longest)
  return { file, ok, seconds, megabytes: Number((Number(probe.format.size) / 1e6).toFixed(1)), width: picture.width, height: picture.height, framesASecond: up / down, frames: count, streams, stalledFrames: stalls, jumpsAt: jumps, longestAllowed: longest }
}
