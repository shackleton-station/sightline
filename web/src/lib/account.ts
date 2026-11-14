/**
 * Optional sign-in with Google, so a saved plan can be listed and deleted by whoever saved it.
 *
 * The browser keeps Google's signed token for this tab only, and sends it with plan requests. The
 * server checks it every time (web/shared/identity.ts); nothing here is trusted. Google makes a
 * token last an hour, after which the visitor is simply signed out.
 */
export interface Account {
  /** Google's signed token, sent to our server as proof. */
  token: string
  /** A first name to greet with, read from the token for display only. */
  name: string
  /** When the token stops working, in milliseconds. */
  expiresAt: number
}

const KEPT_AS = 'clps.account'

/** Reads the name and expiry out of Google's token. For display only: the server does the checking. */
export function accountFromToken(token: string): Account | null {
  try {
    const payload = token.split('.')[1] ?? ''
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { given_name?: unknown; name?: unknown; exp?: unknown }
    if (typeof claims.exp !== 'number') return null
    const name = typeof claims.given_name === 'string' ? claims.given_name : typeof claims.name === 'string' ? claims.name : ''
    return { token, name, expiresAt: claims.exp * 1000 }
  } catch {
    return null
  }
}

function kept(): Account | null {
  try {
    const stored = sessionStorage.getItem(KEPT_AS)
    return stored ? accountFromToken(stored) : null
  } catch {
    return null
  }
}

let account: Account | null = typeof sessionStorage === 'undefined' ? null : kept()
const listeners = new Set<() => void>()

function set(next: Account | null) {
  account = next
  try {
    if (next) sessionStorage.setItem(KEPT_AS, next.token)
    else sessionStorage.removeItem(KEPT_AS)
  } catch {
    // Private windows may refuse storage; being signed in for this page only is fine.
  }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Who is signed in, or null. An expired token counts as signed out. */
export function currentAccount(now = Date.now()): Account | null {
  return account && account.expiresAt > now ? account : null
}

export function signIn(token: string): boolean {
  const next = accountFromToken(token)
  if (next) set(next)
  return next !== null
}

export function signOut() {
  set(null)
}

/** The header that proves who is asking, or nothing when signed out. */
export function proof(): Record<string, string> {
  const who = currentAccount()
  return who ? { authorization: `Bearer ${who.token}` } : {}
}

let asked: Promise<string | null> | null = null

/** The id Google's button needs, from the server. Null when sign-in isn't switched on. */
export function signInClientId(): Promise<string | null> {
  asked ??= fetch('/api/status')
    .then((response) => (response.ok ? (response.json() as Promise<{ signIn?: unknown }>) : null))
    .then((status) => (typeof status?.signIn === 'string' ? status.signIn : null))
    .catch(() => null)
  return asked
}

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; use_fedcm_for_button?: boolean }): void
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void
  disableAutoSelect(): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let script: Promise<GoogleId | null> | null = null

/** Loads Google's sign-in script, only when someone is about to be offered the button. */
function googleId(): Promise<GoogleId | null> {
  script ??= new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://accounts.google.com/gsi/client'
    tag.async = true
    tag.onload = () => resolve(window.google?.accounts.id ?? null)
    tag.onerror = () => resolve(null)
    document.head.append(tag)
  })
  return script
}

/** Draws Google's own button in `parent`. Returns false if the script couldn't load (offline, or blocked). */
export async function showGoogleButton(parent: HTMLElement, clientId: string): Promise<boolean> {
  const google = await googleId()
  if (!google) return false
  google.initialize({ client_id: clientId, callback: (response) => void (response.credential && signIn(response.credential)), use_fedcm_for_button: true })
  google.renderButton(parent, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' })
  return true
}
