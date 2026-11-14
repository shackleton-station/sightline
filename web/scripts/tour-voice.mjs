// Renders the lines of Scout's tour, once, in the voice Scout speaks with on the site, and writes
// them where the page serves them: public/tour/voice/<id>.mp3, one file a step.
//
// The tour's lines are fixed (src/sightline/tour.json), so they are not asked of /api/speak, which
// would spend the visitors' daily voice allowance on words that never change. Run this again only
// when a step's "say" changes; the files are committed.
//
//   node scripts/tour-voice.mjs            render every step
//   node scripts/tour-voice.mjs --step=scout   render that step alone (the others' files are left as they are)
//   node scripts/tour-voice.mjs --check    render nothing; fail if a file is missing or older than its words
//
// It calls Google Cloud Text-to-Speech as the person signed in to gcloud, billed to the project
// named by GOOGLE_CLOUD_PROJECT (or gcloud's own), exactly as the web server does it
// (server/google.ts): plain text in, MP3 out. About 900 characters in all.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const tour = JSON.parse(readFileSync(`${webDir}src/sightline/tour.json`, 'utf8'))
const outDir = `${webDir}public/tour/voice/`
const VOICE = process.env.VOICE_NAME ?? 'en-US-Chirp3-HD-Leda'
/** What each file was rendered from, so --check can tell when a step's words have changed since. */
const indexFile = `${outDir}index.json`
const hashOf = (text) => createHash('sha256').update(`${VOICE}\n${text}`).digest('hex').slice(0, 16)

if (process.argv.includes('--check')) {
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { lines: {} }
  const stale = tour.steps.filter((step) => !existsSync(`${outDir}${step.id}.mp3`) || index.lines[step.id]?.hash !== hashOf(step.say))
  for (const step of stale) console.log(`FAIL ${step.id}: its voice file is missing or was rendered from other words`)
  if (stale.length === 0) console.log(`ok   all ${tour.steps.length} voice files match the tour's words (${VOICE})`)
  process.exit(stale.length ? 1 : 0)
}

const gcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8' }).trim()
const project = process.env.GOOGLE_CLOUD_PROJECT ?? gcloud('config', 'get-value', 'project')
if (!project) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the project Text-to-Speech is billed to.')
  process.exit(1)
}
const token = gcloud('auth', 'print-access-token')
mkdirSync(outDir, { recursive: true })

// One step alone, when asked: the other steps keep their files and their lines in the index.
const only = process.argv.find((arg) => arg.startsWith('--step='))?.slice('--step='.length)
if (only && !tour.steps.some((step) => step.id === only)) {
  console.error(`No step called "${only}" in the tour.`)
  process.exit(1)
}
const lines = only && existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).lines : {}
for (const step of tour.steps.filter((one) => !only || one.id === only)) {
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-goog-user-project': project },
    // The text goes in `text`, never `ssml`: nothing in it is read as an instruction to the voice.
    body: JSON.stringify({ input: { text: step.say }, voice: { languageCode: VOICE.split('-').slice(0, 2).join('-'), name: VOICE }, audioConfig: { audioEncoding: 'MP3' } }),
  })
  if (!response.ok) {
    console.error(`${step.id}: Text-to-Speech answered HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
    process.exit(1)
  }
  const { audioContent } = await response.json()
  const bytes = Buffer.from(audioContent, 'base64')
  writeFileSync(`${outDir}${step.id}.mp3`, bytes)
  lines[step.id] = { hash: hashOf(step.say), bytes: bytes.length, say: step.say }
  console.log(`ok   ${step.id}.mp3  ${(bytes.length / 1024).toFixed(0)} kB`)
}
writeFileSync(indexFile, `${JSON.stringify({ voice: VOICE, disclosure: tour.voice.disclosure, lines }, null, 2)}\n`)
console.log(`Wrote ${only ? 1 : tour.steps.length} file(s) and index.json to ${outDir}`)
