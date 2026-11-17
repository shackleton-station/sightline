/**
 * The plans saved from this browser, so their owner can pick one up again without keeping its link.
 *
 * Saving needs no sign-in, so the service does not know whose a plan is. The browser does: each
 * save is noted here, newest first, and the Library lists them under "Your plans". It is a
 * convenience of this browser only: another device, or cleared site data, does not have the list,
 * and the plans themselves are still opened by their links.
 */

/** One plan saved from this browser. */
export interface MyPlan {
  id: string
  title: string
  /** When it was saved, as an ISO time. */
  saved: string
}

const KEY = 'sightline.myPlans'
/** The most plans remembered; past it the oldest are forgotten. */
export const MAX_MY_PLANS = 30

/** The list read back from what the browser kept: only entries of the right shape. */
export function readMyPlans(text: string | null): MyPlan[] {
  try {
    const kept: unknown = JSON.parse(text ?? '[]')
    if (!Array.isArray(kept)) return []
    const isPlan = (one: unknown): one is MyPlan => typeof one === 'object' && one !== null && (['id', 'title', 'saved'] as const).every((name) => typeof (one as Record<string, unknown>)[name] === 'string')
    return kept.filter(isPlan).slice(0, MAX_MY_PLANS)
  } catch {
    return []
  }
}

/** The list with a plan just saved at its head, and no plan twice. */
export function withMyPlan(plans: MyPlan[], plan: MyPlan): MyPlan[] {
  return [plan, ...plans.filter((one) => one.id !== plan.id)].slice(0, MAX_MY_PLANS)
}

/** The plans saved from this browser, newest first. Empty where the browser keeps nothing. */
export function myPlans(): MyPlan[] {
  try {
    return readMyPlans(window.localStorage.getItem(KEY))
  } catch {
    return []
  }
}

/** Notes a plan just saved. Does nothing where the browser refuses storage. */
export function rememberPlan(id: string, title: string, now = new Date()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(withMyPlan(myPlans(), { id, title, saved: now.toISOString() })))
  } catch {
    // A private window may refuse storage: the plan is saved all the same, and its link opens it.
  }
}

/** Forgets a plan, once its owner has deleted it. Does nothing where the browser refuses storage. */
export function forgetPlan(id: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(myPlans().filter((one) => one.id !== id)))
  } catch {
    // Nothing was kept, so there is nothing to forget.
  }
}
