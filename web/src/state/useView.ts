import { createContext, type Dispatch, useContext } from 'react'
import type { Action, View } from './viewStore'

export const ViewContext = createContext<View | null>(null)
export const DispatchContext = createContext<Dispatch<Action> | null>(null)

/** What's on screen right now. */
export function useView(): View {
  const view = useContext(ViewContext)
  if (!view) throw new Error('useView needs a ViewProvider above it')
  return view
}

/** Sends a change to the view. */
export function useViewDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext)
  if (!dispatch) throw new Error('useViewDispatch needs a ViewProvider above it')
  return dispatch
}
