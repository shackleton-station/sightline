import { HYPE_PATH, hypeListener } from '../lib/hypeEgg'

/** Whether a key press went to something the visitor writes in. */
function isWriting(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/** Listens on this page for the word, and opens the Hype page when it is typed. Every page's entry calls this once. */
export function listenForHype(): void {
  if (window.location.pathname.startsWith(HYPE_PATH)) return
  const listener = hypeListener()
  window.addEventListener('keydown', (event) => {
    if (listener.press({ key: event.key, modified: event.metaKey || event.ctrlKey || event.altKey, writing: isWriting(event.target) })) window.location.assign(HYPE_PATH)
  })
}
