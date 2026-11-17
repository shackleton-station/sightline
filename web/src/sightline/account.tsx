import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentAccount, showGoogleButton, signInClientId, subscribe } from '../lib/account'

/** Who is signed in on this tab, and whether sign-in is switched on for this site at all. */
export interface AccountState {
  /** The id Google's button needs; null until the server has said, and where sign-in is off: then nothing about it is drawn. */
  clientId: string | null
  signedIn: boolean
  /** A first name to greet with; '' when Google's token carries none. */
  name: string
}

/**
 * Optional sign-in with Google, as the Sightline screen sees it (lib/account.ts keeps the token, for
 * this tab only, and the plans service checks it on every request). Everything works signed out:
 * signing in only gives saved plans an owner, who can list and delete them.
 */
export function useAccount(): AccountState {
  const [clientId, setClientId] = useState<string | null>(null)
  const token = useSyncExternalStore(subscribe, () => currentAccount()?.token ?? null)
  useEffect(() => {
    let current = true
    void signInClientId().then((id) => current && setClientId(id))
    return () => {
      current = false
    }
  }, [])
  return { clientId, signedIn: token !== null, name: token !== null ? (currentAccount()?.name ?? '') : '' }
}

/**
 * Google's own sign-in button, drawn by Google's script, which is fetched only when this is shown.
 * Where the script cannot load (offline, or blocked), one line says so and that nothing else needs it.
 */
export function GoogleSignIn({ clientId }: { clientId: string }) {
  const button = useRef<HTMLDivElement>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    if (!button.current) return
    let current = true
    void showGoogleButton(button.current, clientId).then((shown) => current && setBlocked(!shown))
    return () => {
      current = false
    }
  }, [clientId])
  return (
    <>
      <div ref={button} className="sl-google" />
      {blocked && <p className="sl-google-blocked">Google’s sign-in could not load here. Everything else works without it.</p>}
    </>
  )
}

/** What signing in is for and what is kept, in one sentence, with the two pages that say more. */
export function SignInMeans() {
  return (
    <>
      We keep no name or email, only a fingerprint that tells your plans from other people’s. <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a>
    </>
  )
}
