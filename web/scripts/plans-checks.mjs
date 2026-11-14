// The checks on the plans API that both the site's smoke test (smoke.mjs) and the plans service's
// own deploy check (plans-check.mjs) run. They go through whatever address they are given: the
// site's public address or the plans service's own.
//
// Only the plans service answers /api/plans. It has a status address (GET /api/plans/status), so
// asking for it says whether an address reaches the service. The web server has no plans API: on
// its own address every one of these paths is 404.

/**
 * A plan id of the right shape, so the service does ask the database for it. Ids are 8 random
 * letters out of 31, so the chance that a real plan has this one is 1 in 31 to the 8th power.
 */
const NO_SUCH_PLAN = 'zzzzzzzz'
const VIEW = '#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan'

const json = async (response) => response.json().catch(() => ({}))

/**
 * Who answers /api/plans at `base`: `{ by: 'plans', status }` with the service's status, `{ by: 'web' }`
 * when only the web server is there (its 404: it has no plans API), or `{ by: 'nobody', code }` when
 * nothing sensible answers.
 */
export async function whoAnswersPlans(base) {
  const response = await fetch(`${base}/api/plans/status`, { signal: AbortSignal.timeout(15_000) })
  const body = await json(response)
  if (response.status === 200 && body.service === 'plans') return { by: 'plans', status: body }
  if (response.status === 404 && body.error === 'not-found') return { by: 'web' }
  return { by: 'nobody', code: response.status }
}

/**
 * The checks that change nothing: an impossible plan is 404, the list needs sign-in, another site
 * is refused, and an unknown method is 405. One Firestore read in all (the impossible plan).
 * `check(name, ok, detail)` records each result.
 */
export async function checkPlansReadOnly(base, check) {
  const missing = await fetch(`${base}/api/plans/${NO_SUCH_PLAN}`)
  const missingBody = await json(missing)
  check('a plan that does not exist is 404, from the database', missing.status === 404 && missingBody.error === 'not-found' && missing.headers.get('cache-control') === 'no-store', `${missing.status} ${JSON.stringify(missingBody)}`)

  const list = await fetch(`${base}/api/plans`)
  const listBody = await json(list)
  check("the list of one's own plans needs sign-in", list.status === 401 && listBody.error === 'sign-in', `${list.status} ${JSON.stringify(listBody)}`)

  const forged = await fetch(`${base}/api/plans`, { headers: { authorization: 'Bearer not-a-google-token' } })
  check('a made-up sign-in token is refused', forged.status === 401, `${forged.status}`)
  await forged.body?.cancel()

  const outsider = await fetch(`${base}/api/plans`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ title: 'x', view: VIEW }) })
  const outsiderBody = await json(outsider)
  check('saving a plan from another site is refused', outsider.status === 403 && outsiderBody.error === 'origin', `${outsider.status} ${JSON.stringify(outsiderBody)}`)

  const method = await fetch(`${base}/api/plans/${NO_SUCH_PLAN}`, { method: 'PUT', headers: { origin: base } })
  check('a method the API does not have is 405', method.status === 405, `${method.status}`)
  await method.body?.cancel()
}

/**
 * The checks that save: one plan, for real, with an idempotency key. Then the same request again
 * (the first answer must come back and nothing more be saved), the same key with another plan (422),
 * and the plan opened by its id. Returns the plan's id, or null if the save failed.
 *
 * This leaves one plan in the database. It has no owner, so nobody can delete it; the database
 * removes it 180 days later, as it does every plan. Three of the visitor's five saves a minute are used.
 */
export async function checkPlansSave(base, check, label = 'check') {
  const key = `"${crypto.randomUUID()}"`
  const plan = { title: `Deploy check (${label})`.slice(0, 80), note: 'Saved by an automated check. Safe to ignore.', view: VIEW }
  const post = (body) => fetch(`${base}/api/plans`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'idempotency-key': key }, body: JSON.stringify(body) })

  const first = await post(plan)
  const firstBody = await json(first)
  check('a plan is saved', first.status === 201 && typeof firstBody.id === 'string' && first.headers.get('idempotent-replayed') === null, `${first.status} ${JSON.stringify(firstBody)}`)
  if (first.status !== 201) return null

  const again = await post(plan)
  const againBody = await json(again)
  check('the same save sent again gets the first answer, and is not saved twice', again.status === 201 && againBody.id === firstBody.id && again.headers.get('idempotent-replayed') === 'true', `${again.status} ${JSON.stringify(againBody)} replayed=${again.headers.get('idempotent-replayed')}`)

  const other = await post({ ...plan, title: 'A different plan under the same key' })
  const otherBody = await json(other)
  check('the same key with a different plan is refused', other.status === 422 && otherBody.error === 'key-reused', `${other.status} ${JSON.stringify(otherBody)}`)

  const opened = await fetch(`${base}/api/plans/${firstBody.id}`)
  const openedBody = await json(opened)
  const brief = Array.isArray(openedBody.plan?.brief) ? openedBody.plan.brief.map((item) => item.label) : []
  check('the saved plan opens, with a brief worked out from the site data', opened.status === 200 && openedBody.plan?.view === VIEW && openedBody.mine === false && brief.includes('Site') && brief.includes('Month'), `${opened.status} ${JSON.stringify(openedBody).slice(0, 200)}`)
  return firstBody.id
}
