/**
 * Fired on `window` when a page rewrites its own address. `history.replaceState` fires no event of
 * its own, and a presenter's page wants to know at once (lib/followClient.ts).
 */
export const ADDRESS_WRITTEN = 'addresswritten'

/** Rewrites this page's address to match what is on screen: no page load, nothing added to the Back button. */
export function setAddressBar(address: string) {
  try {
    window.history.replaceState(null, '', address)
  } catch {
    // Safari refuses more than 100 rewrites in 30 seconds. The page still works; only the address is behind.
    return
  }
  window.dispatchEvent(new Event(ADDRESS_WRITTEN))
}
