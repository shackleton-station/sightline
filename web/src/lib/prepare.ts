/**
 * Asks for files ahead of the moment they are needed, quietly: one at a time, at low priority,
 * after a short pause, so whatever the screen is loading now goes first. Each is a file the app
 * would ask for anyway; having been read once, it is on hand (or needs only a check with the
 * server) when a later step opens the panel that reads it. A file that is missing or fails is
 * passed over. Returns a way to stop.
 */
export function prepareFiles(files: string[], startAfterMs = 1500): () => void {
  let stopped = false
  const base = import.meta.env.BASE_URL
  const timer = window.setTimeout(async () => {
    for (const file of files) {
      if (stopped) return
      try {
        // Read to its end, so the whole file is kept and not only its first bytes.
        await (await fetch(base + file.replace(/^\//, ''), { priority: 'low' } as RequestInit)).arrayBuffer()
      } catch {
        // Not there, or the network is slow: the step that needs it will ask again.
      }
    }
  }, startAfterMs)
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}
