import { OLD_HOME } from '../lib/siteTabs'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentAccount, showGoogleButton, signInClientId, signOut, subscribe } from '../lib/account'
import { deletePlan, listPlans, planHash, type PlanLine, withPage } from '../lib/plans'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

interface Props {
  /** Changes when a plan has just been saved, so the list is read again. */
  refresh: string | null
}

/**
 * Optional sign-in, shown inside the share dialog. Signed out: Google's button and what signing
 * in is for. Signed in: the visitor's own plans, each with a way to open and delete it.
 * Draws nothing at all when sign-in isn't switched on for this site.
 */
export function AccountBox({ refresh }: Props) {
  const [clientId, setClientId] = useState<string | null>(null)
  const account = useSyncExternalStore(subscribe, () => currentAccount()?.token ?? null)
  const name = currentAccount()?.name ?? ''
  const button = useRef<HTMLDivElement>(null)
  const [blocked, setBlocked] = useState(false)
  const [plans, setPlans] = useState<PlanLine[] | null>(null)
  // The marker for the page after the plans shown; null when they are all shown.
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void signInClientId().then((id) => current && setClientId(id))
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (!clientId || account || !button.current) return
    let current = true
    void showGoogleButton(button.current, clientId).then((shown) => current && setBlocked(!shown))
    return () => {
      current = false
    }
  }, [clientId, account])

  const load = useCallback(async () => {
    const result = await listPlans()
    if (result.ok) {
      setPlans(result.value.plans)
      setNext(result.value.next)
    } else setProblem(result.message)
  }, [])

  const more = async () => {
    if (!next) return
    setLoadingMore(true)
    setProblem(null)
    const result = await listPlans(next)
    setLoadingMore(false)
    if (result.ok) {
      setPlans((shown) => withPage(shown ?? [], result.value.plans))
      setNext(result.value.next)
    } else setProblem(result.message)
  }

  useEffect(() => {
    setPlans(null)
    setNext(null)
    setProblem(null)
    if (account) void load()
  }, [account, refresh, load])

  const remove = async (id: string) => {
    setConfirming(null)
    const result = await deletePlan(id)
    if (result.ok) setPlans((list) => list?.filter((plan) => plan.id !== id) ?? null)
    else setProblem(result.message)
  }

  if (!clientId) return null

  if (!account) {
    return (
      <section className="account-box" aria-label="Sign in">
        <p>
          <strong>Optional:</strong> sign in to keep a list of the plans you save and be able to delete them. We keep
          no name or email, only a fingerprint that tells your plans apart from other people's. <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a>
        </p>
        <div ref={button} className="account-google" />
        {blocked && <p className="share-plan-problem">Google's sign-in couldn't load here. You can still save a plan without it.</p>}
      </section>
    )
  }

  return (
    <section className="account-box" aria-label="Your plans">
      <p className="account-who">
        <span>Signed in{name ? ` as ${name}` : ''}. Plans you save now are yours to delete.</span>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </p>
      {problem && (
        <p className="share-plan-problem" role="alert">
          {problem}
        </p>
      )}
      {plans && plans.length === 0 && <p>You haven't saved a plan while signed in yet.</p>}
      {plans && plans.length > 0 && (
        <ul className="account-plans">
          {plans.map((plan) => (
            <li key={plan.id}>
              <a href={`${OLD_HOME}${planHash(plan.id)}`}>{plan.title}</a>
              <small>saved {day(plan.created)}</small>
              {confirming === plan.id ? (
                <>
                  <button type="button" className="danger" onClick={() => void remove(plan.id)}>
                    Delete for good
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(plan.id)} aria-label={`Delete the plan ${plan.title}`}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {plans && next && (
        <button type="button" className="account-more" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  )
}
