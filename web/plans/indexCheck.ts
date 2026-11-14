import { googleToken } from '../shared/google'
import { newId } from '../shared/ids'
import { firestorePlans } from './firestorePlans'
import { newestFirst, type PageStart, type Plan } from './store'

/**
 * Checks that "my plans" is answered by the composite index and pages past 200, on a real database
 * (docs/ARCHITECTURE_PHASE_5.md, checks (b) and (c)). Not part of the service: run by hand.
 *
 *   npx tsx plans/indexCheck.ts --project clps-compute-6z1nc --database plans
 *       Read-only. Asks Firestore's Query Explain how it would run the paged query, without running
 *       it (one document read is billed). Passes when the plan uses the index
 *       (owner ASC, created DESC, __name__ DESC).
 *
 *   npx tsx plans/indexCheck.ts --project clps-compute-6z1nc --database plans --write
 *       Also writes 205 plans for a made-up owner that no sign-in can produce, pages through them
 *       100 at a time with the service's own store code, checks every one comes back once, newest
 *       first, with no fall back to the old query, and deletes all 205 again, also if a step fails.
 *
 * The caller's own Google credentials are used: GOOGLE_OAUTH_ACCESS_TOKEN, or the application
 * default credentials. Add --host http://127.0.0.1:8085 to run it against the emulator, which has
 * no Query Explain (it ignores the request and answers the query) and no index to find.
 */
const flag = (name: string) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const project = flag('--project')
const database = flag('--database') ?? 'plans'
const host = flag('--host')
const write = process.argv.includes('--write')
if (!project) {
  console.error('Usage: npx tsx plans/indexCheck.ts --project <id> [--database plans] [--host <emulator URL>] [--write]')
  process.exit(2)
}

const EXPECTED = '(owner ASC, created DESC, __name__ DESC)'
const COUNT = 205
const token = googleToken()
const documents = `${host ?? 'https://firestore.googleapis.com'}/v1/projects/${project}/databases/${database}/documents`
let failed = false
const report = (ok: boolean, line: string) => {
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)
}

/** The plan Firestore makes for the paged query, as Query Explain reports it. Nothing is read. */
async function explain(owner: string): Promise<string> {
  const structuredQuery = {
    from: [{ collectionId: 'plans' }],
    where: { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: owner } } },
    orderBy: [
      { field: { fieldPath: 'created' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ],
    limit: 101,
  }
  const response = await fetch(`${documents}:runQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ structuredQuery, explainOptions: { analyze: false } }),
  })
  const rows = (await response.json()) as { error?: { status?: string; message?: string }; explainMetrics?: { planSummary?: { indexesUsed?: { properties?: string }[] } } }[]
  const error = rows.find((row) => row.error)?.error
  if (error) return `refused: ${error.status} (${error.message})`
  const used = rows.find((row) => row.explainMetrics)?.explainMetrics?.planSummary?.indexesUsed
  return used ? used.map((index) => index.properties).join(' + ') : 'no plan in the answer (the emulator gives none)'
}

const owner = `phase5-check-${newId(8)}`
const plan = await explain(owner)
report(plan === EXPECTED, `Query Explain: the paged query uses ${plan}; expected ${EXPECTED}`)

if (write) {
  const warnings: string[] = []
  const warn = console.warn
  console.warn = (...parts: unknown[]) => void warnings.push(parts.join(' '))
  const store = firestorePlans({ project, database, host }, token)
  const start = Date.now() - COUNT * 1000
  const saved: Plan[] = Array.from({ length: COUNT }, (_, n) => ({
    id: newId(8),
    title: 'Phase 5 paging check (deleted at once)',
    note: '',
    view: '#a=connecting-ridge@2027-06&t=497',
    brief: [],
    created: new Date(start + n * 1000).toISOString(),
    // If the clean-up below is ever cut short, the database deletes these within a day of this.
    expires: new Date(Date.now() + 86_400_000).toISOString(),
    owner,
  }))
  try {
    for (let n = 0; n < COUNT; n += 25) await Promise.all(saved.slice(n, n + 25).map((item) => store.create(item)))
    report(true, `saved ${COUNT} plans for the made-up owner ${owner}`)
    const seen: string[] = []
    const sizes: number[] = []
    let after: PageStart | undefined
    for (let pages = 0; pages < 10; pages++) {
      const page = await store.pageByOwner(owner, { limit: 100, after })
      seen.push(...page.plans.map((item) => item.id))
      sizes.push(page.plans.length)
      const last = page.plans.at(-1)
      if (!page.more || !last) break
      after = { created: last.created, id: last.id }
    }
    const expected = saved.toSorted(newestFirst).map((item) => item.id)
    report(JSON.stringify(sizes) === '[100,100,5]', `pages of ${sizes.join(', ')}; expected 100, 100, 5`)
    report(JSON.stringify(seen) === JSON.stringify(expected), `all ${COUNT} plans came back once, newest first`)
    report(warnings.length === 0, warnings.length === 0 ? 'listed by the index, never the old way' : `fell back to the old query: ${warnings[0]}`)
  } finally {
    console.warn = warn
    for (let n = 0; n < COUNT; n += 25) await Promise.all(saved.slice(n, n + 25).map((item) => store.remove(item.id)))
    console.log(`deleted the ${COUNT} plans again`)
  }
}

console.log(failed ? 'Some checks failed' : 'All checks passed')
process.exit(failed ? 1 : 0)
