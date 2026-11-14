import { useEffect, useState } from 'react'
import { BriefingApp } from './BriefingApp'

/**
 * A briefing is written once, for the site, month and mission in its address, and then kept while it
 * plays. When the address is changed from outside (a link pasted into the open tab, or a presenter
 * being followed), the briefing for the new address starts from its beginning, with no page load.
 * The page's own rewrites of its address don't fire "hashchange", so they don't restart it.
 */
export function BriefingPage() {
  const [address, setAddress] = useState(() => window.location.hash)
  useEffect(() => {
    const onHashChange = () => setAddress(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return <BriefingApp key={address} />
}
