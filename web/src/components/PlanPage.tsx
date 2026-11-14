import { useEffect, useState } from 'react'
import { deletePlan, loadPlan, type Plan } from '../lib/plans'
import { tabLinks } from '../lib/siteTabs'
import '../shell/how.css'
import './planPage.css'

interface Props {
  id: string
  /** Open the plan's view in the app. */
  onOpen: (view: string) => void
  /** Tells the page above which view the plan holds, so its design tabs open on it. */
  onLoaded: (view: string) => void
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** What someone sees when they open a shared plan: its name, the note, and what the data said when it was saved. */
export function PlanPage({ id, onOpen, onLoaded }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** The signed-in visitor saved this plan, so they may delete it. */
  const [mine, setMine] = useState(false)
  const [deleting, setDeleting] = useState<'no' | 'asking' | 'done'>('no')

  useEffect(() => {
    let current = true
    setPlan(null)
    setProblem(null)
    setMine(false)
    setDeleting('no')
    void loadPlan(id).then((result) => {
      if (!current) return
      if (result.ok) {
        setPlan(result.value.plan)
        setMine(result.value.mine)
        onLoaded(result.value.plan.view)
      } else setProblem(result.message)
    })
    return () => {
      current = false
    }
  }, [id, onLoaded])

  const remove = async () => {
    const result = await deletePlan(id)
    if (result.ok) {
      setPlan(null)
      setDeleting('done')
    } else setProblem(result.message)
  }

  if (deleting === 'done') {
    return (
      <main className="how plan-page">
        <div className="how-intro">
          <p className="how-kicker">A shared mission plan</p>
          <h1>The plan is deleted</h1>
          <p>Its link no longer opens anything.</p>
          <p>
            <a href="/">Back to the Moon →</a>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="how plan-page">
      <div className="how-intro">
        <p className="how-kicker">A shared mission plan</p>
        {problem && (
          <>
            <h1>We couldn't open this plan</h1>
            <p role="alert">{problem}</p>
          </>
        )}
        {!problem && !plan && <h1 role="status">Opening the plan…</h1>}
        {plan && (
          <>
            <h1>{plan.title}</h1>
            {plan.note && <p className="plan-note">{plan.note}</p>}
            <p className="how-caption">Saved {day(plan.created)}. Kept until {day(plan.expires)}.</p>
          </>
        )}
      </div>

      {plan && (
        <>
          <section className="how-act" aria-labelledby="plan-brief">
            <h2 id="plan-brief">What the data says</h2>
            <p className="how-lede">Worked out from the same NASA data as the rest of the site, when the plan was saved.</p>
            <dl className="plan-brief">
              {plan.brief.map((item, i) => (
                <div key={i}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="how-act" aria-labelledby="plan-open">
            <h2 id="plan-open">See it for yourself</h2>
            <p className="how-lede">Open the plan on the site: the same place, hour and limits, ready to explore.</p>
            <div className="plan-open">
              <button type="button" className="primary" onClick={() => onOpen(plan.view)}>
                Open this plan →
              </button>
              {tabLinks(plan.view)
                .filter((tab) => tab.design && tab.id !== 'classic')
                .map((tab) => (
                  <a key={tab.id} href={tab.href}>
                    Open in {tab.label}
                  </a>
                ))}
            </div>
          </section>

          {mine && (
            <section className="how-act" aria-labelledby="plan-yours">
              <h2 id="plan-yours">This plan is yours</h2>
              <p className="how-lede">You saved it while signed in, so you can delete it. Otherwise it is kept until the date above.</p>
              <div className="plan-open">
                {deleting === 'asking' ? (
                  <>
                    <button type="button" className="danger" onClick={() => void remove()}>
                      Delete for good
                    </button>
                    <button type="button" onClick={() => setDeleting('no')}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setDeleting('asking')}>
                    Delete this plan
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="how-foot">
        <p>
          A practice demo by team Shackleton Station for the NASA Space Apps Challenge 2026. Results are a first pass
          for learning and comparison, not mission planning advice.
        </p>
      </footer>
    </main>
  )
}
