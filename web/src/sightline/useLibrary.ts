import { useCallback, useEffect, useState } from 'react'
import { type LibraryEntry, readTray, toggleTray } from '../lib/library'
import { loadLibrary } from '../lib/plans'

/** The library as the Planner holds it: being read, read, not offered by this site, or not reached. */
export type LibraryState = { kind: 'loading' } | { kind: 'ready'; entries: LibraryEntry[] } | { kind: 'none' } | { kind: 'failed'; message: string }

/**
 * The library, read from the plans service the first time it is wanted and again on `reload`.
 * `wanted` is false until the Library tab or the tray is first opened, so a visit that never looks
 * at the library never asks for it.
 */
export function useLibrary(wanted: boolean): { state: LibraryState; reload: () => void } {
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    if (!wanted) return
    let current = true
    setState({ kind: 'loading' })
    void loadLibrary().then((result) => {
      if (!current) return
      if (!result.ok) setState({ kind: 'failed', message: result.message })
      else setState(result.value === null ? { kind: 'none' } : { kind: 'ready', entries: result.value })
    })
    return () => {
      current = false
    }
  }, [wanted, asked])
  return { state, reload: useCallback(() => setAsked((n) => n + 1), []) }
}

const TRAY_KEY = 'sightline.library.tray'

/**
 * The tray: the scenarios pulled in from the library, remembered in this browser so they are still
 * there on the next visit. Works without storage, just not remembered.
 */
export function useTray(): [LibraryEntry[], (entry: LibraryEntry) => void] {
  const [tray, setTray] = useState<LibraryEntry[]>(() => {
    try {
      return readTray(window.localStorage.getItem(TRAY_KEY))
    } catch {
      return []
    }
  })
  const toggle = useCallback((entry: LibraryEntry) => {
    setTray((before) => {
      const next = toggleTray(before, entry)
      try {
        window.localStorage.setItem(TRAY_KEY, JSON.stringify(next))
      } catch {
        // A private window may refuse storage: the tray then lasts as long as the page.
      }
      return next
    })
  }, [])
  return [tray, toggle]
}
