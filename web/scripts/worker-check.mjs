// Checks a deployed events worker on its own address, as the deployer:
//
//   ID_TOKEN=… node scripts/worker-check.mjs https://canary---clps-events-worker-….run.app --version abc1234 --data-version 0123456789abcdef
//   ID_TOKEN=… node scripts/worker-check.mjs https://clps-events-worker-….run.app --version abc1234 --live
//
// ID_TOKEN is a Google identity token for the deployer, made for the worker's address (the deploy
// workflow gets one from GitHub's sign-in to Google Cloud). The worker has no public address, so this
// is what "test the new version before it takes traffic" means for it:
//   1. Without a token it must refuse. If it answers, the service has been made public by mistake.
//   2. Its status must report the commit and the data version this deploy built.
//   3. It must refuse a message delivered by the deployer: only Pub/Sub's push identity may deliver.
//   4. Its self-check must pass: it counts one made-up event twice on a scratch day in the real
//      database, and checks it was added once and refused once. This is the real write path, with the
//      worker's real permissions, before any real message reaches the new version.
// With --live only 1 and 2 run, against the address that takes the messages.
// Exits non-zero on the first thing that is wrong, so a deploy can stop on it.
const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const token = process.env.ID_TOKEN
if (!base || !token) {
  console.error('Usage: ID_TOKEN=<identity token> node scripts/worker-check.mjs <worker URL> [--version <commit>] [--data-version <hash>] [--live]')
  process.exit(2)
}

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const call = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } })

// 1. No token: Cloud Run itself must refuse, before the worker's code runs.
const anonymous = await fetch(`${base}/status`)
await anonymous.body?.cancel()
check('refuses a caller with no identity', anonymous.status === 401 || anonymous.status === 403, `${anonymous.status}`)

// 2. What is running.
const response = await call('/status')
const status = await response.json().catch(() => ({}))
check('answers its status to the deployer', response.status === 200 && status.service === 'events-worker', `${response.status} ${JSON.stringify(status).slice(0, 200)}`)
const version = flag('--version')
if (version) check('runs the commit this deploy built', status.version === version, `${status.version}, expected ${version}`)
const dataVersion = flag('--data-version')
if (dataVersion) check('was built with the site data of this commit', status.dataVersion === dataVersion, `${status.dataVersion}, expected ${dataVersion}`)
check('keeps its counts in Firestore, asks callers who they are, and is not paused', status.store === 'firestore' && status.callerCheck === 'on' && status.paused === false, `${status.store}, caller check ${status.callerCheck}, paused ${status.paused}`)

if (!process.argv.includes('--live')) {
  // 3. A well-formed message, from the wrong identity. 403 "wrong-caller" also shows the worker reads
  //    who is calling from a real Google token, which is how it will recognise Pub/Sub.
  const event = { kind: 'copilot_question', id: `deploy-check-${Date.now()}`, at: new Date().toISOString(), cached: false, outcome: 'answered' }
  const body = JSON.stringify({ message: { data: Buffer.from(JSON.stringify(event)).toString('base64'), messageId: '0' }, subscription: 'deploy-check' })
  const pushed = await call('/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  const refusal = await pushed.json().catch(() => ({}))
  check('refuses a message delivered by anyone but Pub/Sub', pushed.status === 403 && refusal.error === 'wrong-caller', `${pushed.status} ${refusal.error ?? ''}`)

  // 4. The real write path, on a scratch day.
  const checked = await call('/selfcheck', { method: 'POST' })
  const result = await checked.json().catch(() => ({}))
  check('counts an event once and refuses it the second time, in the real database', checked.status === 200 && result.ok === true, `${checked.status} ${JSON.stringify(result)}`)
}

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
