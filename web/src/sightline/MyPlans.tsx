import { useCallback, useEffect, useState } from 'react'
import { signOut } from '../lib/account'
import { savedDay } from '../lib/library'
import { forgetPlan, myPlans } from '../lib/myPlans'
import { deletePlan, listPlans, type PlanLine, withPage } from '../lib/plans'
import { GoogleSignIn, SignInMeans, useAccount } from './account'

interface Props {
  /** Open a saved plan again, as its link would: its scenarios, its mission and the screen it was saved on. */
  onResume: (id: string) => void
}

/** One line of the list: a plan, when it was saved, and whether the signed-in visitor owns it (and so may delete it). */
interface Line {
  id: string
  title: string
  saved: string
  owned: boolean
}

/**
 * Your plans: the first thing in the Library, because coming back to your own plan is what most
 * visits to it are for. Each has one button to pick it up where it was left.
 *
 * Signed out, they are the plans saved from this browser, kept in this browser. Signing in with
 * Google is optional, and offered under the list: then the plans saved while signed in, on any
 * device, are listed from the plans service, each with "Delete" (asked twice), and after them the
 * ones this browser saved without an owner. The titles are the visitor's own either way: the
 * library everyone reads carries no title and no plan's id.
 */
export function MyPlans({ onResume }: Props) {
  // Read once as the Library opens: a plan saved since is there the next time it does.
  const [local, setLocal] = useState(myPlans)
  const { clientId, signedIn, name } = useAccount()
  const [owned, setOwned] = useState<PlanLine[] | null>(null)
  // The marker for the page after the plans shown; null when they are all shown.
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listPlans()
    if (result.ok) {
      setOwned(result.value.plans)
      setNext(result.value.next)
    } else setProblem(result.message)
  }, [])
  useEffect(() => {
    setOwned(null)
    setNext(null)
    setProblem(null)
    setConfirming(null)
    if (signedIn) void load()
  }, [signedIn, load])

  const more = async () => {
    if (!next) return
    setLoadingMore(true)
    setProblem(null)
    const result = await listPlans(next)
    setLoadingMore(false)
    if (result.ok) {
      setOwned((shown) => withPage(shown ?? [], result.value.plans))
      setNext(result.value.next)
    } else setProblem(result.message)
  }
  const remove = async (id: string) => {
    setConfirming(null)
    const result = await deletePlan(id)
    if (!result.ok) return setProblem(result.message)
    setOwned((list) => list?.filter((plan) => plan.id !== id) ?? null)
    forgetPlan(id)
    setLocal((list) => list.filter((plan) => plan.id !== id))
  }

  const ownedIds = new Set((owned ?? []).map((plan) => plan.id))
  const lines: Line[] = [
    ...(owned ?? []).map((plan) => ({ id: plan.id, title: plan.title, saved: plan.created, owned: true })),
    ...local.filter((plan) => !ownedIds.has(plan.id)).map((plan) => ({ ...plan, owned: false })),
  ]
  const loading = signedIn && owned === null && problem === null
  return (
    <section className="lib-mine" aria-label="Your plans">
      <div className="lib-mine-head">
        <h3>Your plans</h3>
        {signedIn && (
          <p className="lib-mine-who">
            Signed in{name ? ` as ${name}` : ''}
            <button type="button" className="sl-link" title="Signs this tab out. Your saved plans stay saved, and their links still open them." onClick={signOut}>
              Sign out
            </button>
          </p>
        )}
      </div>
      {problem && (
        <p className="lib-mine-problem" role="alert">
          {problem}
        </p>
      )}
      {loading ? (
        <p className="lib-mine-none">Loading your plans…</p>
      ) : lines.length === 0 ? (
        <p className="lib-mine-none">{signedIn ? 'No plans saved yet. Save one with a name from Share, and it waits here to be picked up again, or deleted.' : 'Nothing saved from this browser yet. Save a plan with a name from Share, and it waits here to be picked up again.'}</p>
      ) : (
        <ul>
          {lines.map((plan) => (
            <li key={plan.id} data-owned={plan.owned || undefined}>
              <div>
                <strong>{plan.title}</strong>
                <small>
                  Saved {savedDay(plan.saved)}
                  {signedIn && !plan.owned ? ' · from this browser, signed out' : ''}
                </small>
              </div>
              <span className="lib-mine-acts">
                {confirming === plan.id ? (
                  <>
                    <button type="button" className="sl-small lib-delete" onClick={() => void remove(plan.id)}>
                      Delete for good
                    </button>
                    <button type="button" className="sl-small" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    {plan.owned && (
                      <button type="button" className="sl-small" aria-label={`Delete the plan ${plan.title}`} title="Deletes this plan for everyone who has its link. It asks once more first." onClick={() => setConfirming(plan.id)}>
                        Delete
                      </button>
                    )}
                    <button type="button" className="sl-small lib-resume" title="Opens this plan again: its scenarios, its mission and the screen it was saved on" onClick={() => onResume(plan.id)}>
                      Resume
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {signedIn && next && (
        <button type="button" className="sl-small lib-mine-more" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
      {clientId && !signedIn && (
        <div className="lib-account">
          <p>
            <strong>Optional:</strong> sign in with Google to list the plans you save on any device, and to delete them. <SignInMeans />
          </p>
          <GoogleSignIn clientId={clientId} />
        </div>
      )}
    </section>
  )
}
