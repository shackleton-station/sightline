/**
 * Copying text that is not known yet: a saved plan's link, which exists only once the plans service
 * has answered.
 *
 * A browser lets a page write to the clipboard only while a press still counts, and some stop
 * counting it before a request comes back. So the copy is asked for at the press, with the text as
 * a promise: the browser waits for it. Where a browser has no such call, the text is copied once it
 * is known, which works wherever the press still counts by then. A browser that refuses both gives
 * `false`, and the page then says only what did happen.
 */
export async function copyWhenKnown(text: Promise<string>): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) {
    // Nothing to copy with: the promise is still waited for, so a failed save is not left unhandled.
    await text.catch(() => undefined)
    return false
  }
  if (typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([new ClipboardItem({ 'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })) })])
      return true
    } catch {
      // Refused, or the text never came: the plain call below settles which.
    }
  }
  try {
    await clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}
