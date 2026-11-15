import { useCallback, useEffect, useRef, useState } from 'react'
import { classicPlanAddress, sightlineView } from '../lib/planLink'
import { loadPlan, type Plan, planIdFrom } from '../lib/plans'
import { panelIn, type PlanPanel } from '../lib/planView'

/** What the screen does when a saved plan arrives. Each is the screen's own way of doing it. */
export interface PlanOpeners {
  /** Open a view's scenarios and mission (the screen's own link opener, which also fetches years it lacks). */
  open: (view: string) => void
  /** Open a side panel, or none. */
  panel: (panel: PlanPanel | null) => void
  /** Unfold the skyline above the time bar. */
  skyline: () => void
  /** Open the Planner on a tab. */
  planner: (tab: 'find' | 'compare') => void
}

export interface PlanLinkState {
  /** The plan that was opened from a short link, until its line is dismissed. */
  plan: Plan | null
  /** Why a short link could not be opened, in plain words; null when there is nothing to say. */
  problem: string | null
  dismiss: () => void
}

/**
 * The plan the page was opened on, read as this file loads. The screen writes its own address as
 * it opens, before anything here runs, and that takes a short link out of the address: so the link
 * is read first, and opened once the screen is up.
 */
let openedOn: string | null = typeof window === 'undefined' ? null : planIdFrom(window.location.hash)

/**
 * Opens a saved plan from its short link ("#plan=<id>"), when the page opens on one or the address
 * changes to one: fetches the plan, shows its view on the Sightline screen with everything the
 * screen had when it was saved, and keeps its name for one quiet line. A view the Sightline screen
 * cannot show goes to the older screen's plan page, where plans always opened.
 */
export function usePlanLink(openers: PlanOpeners): PlanLinkState {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const latest = useRef(openers)
  useEffect(() => {
    latest.current = openers
  })
  useEffect(() => {
    let asked: string | null = null
    const look = () => {
      const id = planIdFrom(window.location.hash) ?? openedOn
      // The link the page opened on is opened once: after that only the address says which plan.
      openedOn = null
      if (!id || id === asked) return
      asked = id
      void loadPlan(id).then((result) => {
        if (asked !== id) return
        if (!result.ok) {
          setProblem(result.message)
          return
        }
        const view = sightlineView(result.value.plan.view)
        if (view === null) {
          window.location.replace(classicPlanAddress(id))
          return
        }
        const params = new URLSearchParams(view.replace(/^#/, ''))
        const { open, panel, skyline, planner } = latest.current
        open(view)
        if (params.get('sky') === '1') skyline()
        panel(panelIn(view))
        const tab = params.get('planner')
        if (tab === 'find' || tab === 'compare') planner(tab)
        setProblem(null)
        setPlan(result.value.plan)
      })
    }
    look()
    window.addEventListener('hashchange', look)
    return () => window.removeEventListener('hashchange', look)
  }, [])
  const dismiss = useCallback(() => {
    setPlan(null)
    setProblem(null)
  }, [])
  return { plan, problem, dismiss }
}
