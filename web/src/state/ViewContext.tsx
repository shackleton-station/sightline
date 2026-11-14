import type { Dispatch, ReactNode } from 'react'
import { DispatchContext, ViewContext } from './useView'
import type { Action, View } from './viewStore'

interface Props {
  view: View
  dispatch: Dispatch<Action>
  children: ReactNode
}

/** Makes the view and its dispatch available to any component below, without passing them down by hand. */
export function ViewProvider({ view, dispatch, children }: Props) {
  return (
    <ViewContext.Provider value={view}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </ViewContext.Provider>
  )
}
