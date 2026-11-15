import { ANTENNA_HEIGHTS_M, PANEL_HEIGHTS_M } from './heights'
import type { Requirements } from './mission'
import { decodeView, encodeView, type ViewState } from './urlState'

/**
 * What a saved plan keeps of the Sightline screen.
 *
 * A plan is stored as a view: the part of an address after "#". The plans service never stores a
 * view as it was sent. It reads the view and writes it out again, so only what the app itself can
 * open is kept. The app's own link (the first scenario and month, the hour, the mission's limits,
 * the other scenarios) is read and written by `urlState`. The Sightline screen adds values of its
 * own after it, which the other pages ignore: those are listed here, each with the test it must
 * pass, and are written back in this order. Anything else in a view is dropped.
 *
 * Both sides use this file: the service to clean a view before storing it, and the page to add the
 * open panel to the view it saves and to read it back.
 */

/**
 * The side panels a saved plan can reopen: the ones the screen has. The mission's limits open in
 * place in the column and are no panel; the easter egg's panel is not kept. A plan saved with a
 * panel that is no longer one opens with none.
 */
export const PLAN_PANELS = ['scout', 'compare', 'layers', 'rover', 'accuracy'] as const
export type PlanPanel = (typeof PLAN_PANELS)[number]

const WHOLE = /^\d{1,5}$/
const NUMBER = /^\d{1,5}(\.\d{1,4})?$/
const oneOf = (values: readonly (string | number)[]) => (value: string) => values.map(String).includes(value)

/** The Sightline screen's own values, in the order they are written, each with what it may hold. */
const KEPT: [name: string, ok: (value: string) => boolean][] = [
  // The steepest ground the mission accepts, in whole degrees (the screen brings it into its slider's range).
  ['slope', (value) => /^\d{1,2}$/.test(value)],
  // The panel's and the antenna's heights above the ground, in metres: only the heights the data has.
  ['hp', oneOf(PANEL_HEIGHTS_M)],
  ['ha', oneOf(ANTENNA_HEIGHTS_M)],
  // Which scenario is on show, when it is not the first (four at most).
  ['sc', (value) => /^[1-3]$/.test(value)],
  // Landing accuracy: the spread in metres, its stretch and its bearing (the screen snaps each to its slider's stops).
  ['acc', (value) => WHOLE.test(value)],
  ['accs', (value) => NUMBER.test(value)],
  ['accd', (value) => /^\d{1,3}$/.test(value)],
  // The skyline unfolded above the time bar.
  ['sky', (value) => value === '1'],
  // The Planner open on one of its tabs.
  ['planner', oneOf(['find', 'compare'])],
  // The side panel that was open.
  ['panel', oneOf(PLAN_PANELS)],
  // The plan was saved from the Sightline screen, which opens it again; a plan without the mark
  // came from an older page, and is opened here only if nothing it held would be lost.
  ['sl', (value) => value === '1'],
]

/** A view as a plan stores it, with what the app's own link said; null if the app cannot open it. */
export function cleanPlanView(view: string, fallback: Requirements): { state: ViewState; view: string } | null {
  const state = decodeView(view, fallback)
  if (!state) return null
  const sent = new URLSearchParams(view.replace(/^#/, ''))
  const kept = KEPT.flatMap(([name, ok]) => {
    const value = sent.get(name)
    return value !== null && ok(value) ? [`&${name}=${value}`] : []
  })
  return { state, view: `${encodeView(state)}${kept.join('')}` }
}

/** A view with the open side panel added, for saving; unchanged when no panel is open or it is not one a plan keeps. */
export function withPanel(view: string, panel: string | null): string {
  const base = view.replace(/&panel=[^&]*/g, '')
  return panel !== null && (PLAN_PANELS as readonly string[]).includes(panel) ? `${base}&panel=${panel}` : base
}

/** A view marked as saved from the Sightline screen, for saving. */
export function markSightline(view: string): string {
  return `${view.replace(/&sl=[^&]*/g, '')}&sl=1`
}

/** Whether a stored view says it was saved from the Sightline screen. */
export function savedBySightline(view: string): boolean {
  return new URLSearchParams(view.replace(/^#/, '')).get('sl') === '1'
}

/** The side panel a view asks for; null if it names none, or one a plan does not keep. */
export function panelIn(view: string): PlanPanel | null {
  const panel = new URLSearchParams(view.replace(/^#/, '')).get('panel')
  return panel !== null && (PLAN_PANELS as readonly string[]).includes(panel) ? (panel as PlanPanel) : null
}
