import { useEffect, useSyncExternalStore } from 'react'
import { beginFollow, type FollowState, followStore } from '../lib/followClient'

/** Whether this tab is presenting, following or neither. The first page to ask picks up where the tab left off. */
export function useFollow(): FollowState {
  useEffect(beginFollow, [])
  return useSyncExternalStore(followStore.subscribe, followStore.get)
}
