/** Name of the build the page is running, set by vite.config.ts. */
declare const __BUILD_ID__: string

const RELOADED_FOR = 'reloaded-for-build'

/** The live build's id if it differs from the running one; null if the same or unknown. */
export async function newerBuild(running: string = __BUILD_ID__): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
    if (!response.ok) return null
    const { build } = (await response.json()) as { build?: unknown }
    return typeof build === 'string' && build !== running ? build : null
  } catch {
    return null
  }
}

/**
 * Reload once if a newer build is live, so a tab left open from an earlier deploy stops asking for
 * files that have moved. Reloads at most once per live build, so a stubborn cache can't cause a loop.
 */
export async function reloadIfStale(): Promise<boolean> {
  const live = await newerBuild()
  if (!live) return false
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === live) return false
    sessionStorage.setItem(RELOADED_FOR, live)
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * Loads a part of the app that is fetched only when needed (the 3D views, the globe). Those files
 * are named for their build, so a tab left open across a deploy asks for names the new version
 * doesn't have. When a load fails and a newer build is live, the page reloads into it, once, on the
 * same view; otherwise the failure is passed on and the caller shows its own message.
 */
export async function loadPart<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    await reloadIfStale()
    throw error
  }
}

/** A page restored from the back-forward cache keeps its old code; check it is still current. */
export function watchForStaleBuild(): void {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void reloadIfStale()
  })
}
