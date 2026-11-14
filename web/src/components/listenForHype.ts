import { HYPE_IN_SIGHTLINE, HYPE_PATH, hypeListener } from '../lib/hypeEgg'

/** Whether a key press went to something the visitor writes in. */
function isWriting(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/** Hears the word typed at this page, outside a text box, and calls back when it is complete. Returns a function that stops listening. */
export function onHypeTyped(found: () => void): () => void {
  const listener = hypeListener()
  const onKey = (event: KeyboardEvent) => {
    if (listener.press({ key: event.key, modified: event.metaKey || event.ctrlKey || event.altKey, writing: isWriting(event.target) })) found()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}

/**
 * For every page but Sightline (which opens the panel in place): the word opens Sightline with
 * its Hype panel open. Each such page's entry calls this once.
 */
export function listenForHype(): void {
  if (window.location.pathname.startsWith(HYPE_PATH)) return
  onHypeTyped(() => window.location.assign(HYPE_IN_SIGHTLINE))
}
