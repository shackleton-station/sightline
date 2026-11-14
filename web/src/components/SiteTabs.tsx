import { useEffect, useRef, useState } from 'react'
import { type TabId, tabLinks } from '../lib/siteTabs'
import { FollowBanner, PresentButton, PresentPanel } from './Follow'
import { useFollow } from './useFollow'
import './siteTabs.css'

interface Props {
  /** The tab this page is, or 'none' for a page that isn't one of the tabs (a shared plan). */
  current: TabId | 'none'
  /** The site, month and hour on screen, as the "#a=…" part of a link; '' if none is chosen. */
  view: string
}

/**
 * The tabs along the top of every page: each page, and each design of the site page, one click away.
 * They are ordinary links, so every tab has an address that can be shared. At the end is "Present"
 * (Follow the presenter), and under the tabs a slim line while this tab is presenting or following.
 */
export function SiteTabs({ current, view }: Props) {
  const active = useRef<HTMLAnchorElement>(null)
  // On a phone the tabs scroll sideways; make sure the one in use is in sight.
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [current])
  const follow = useFollow()
  /** The presenter's code is on show. It opens when presenting starts; on the next page it is put away. */
  const [code, setCode] = useState(false)

  const links = tabLinks(view)
  const designs = links.filter((tab) => tab.design)
  return (
    <nav className="site-tabs" aria-label="Pages and designs">
      <div className="site-tabs-row">
        <a className="site-tabs-brand" href="/" title="Shackleton Station: the front page">
          <span aria-hidden="true">◐</span> <span className="site-tabs-name">Shackleton Station</span>
        </a>
        <ul>
          {links.map((tab) => (
            <li
              key={tab.id}
              className={tab.id === designs[0]?.id ? 'first-design' : tab.id === designs.at(-1)?.id ? 'last-design' : undefined}
            >
              <a
                ref={tab.id === current ? active : undefined}
                className="site-tab"
                href={tab.href}
                title={tab.hint}
                aria-current={tab.id === current ? 'page' : undefined}
              >
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
        <PresentButton state={follow} onOpen={() => setCode(true)} />
      </div>
      <FollowBanner state={follow} onOpen={() => setCode(true)} />
      {code && follow.role === 'presenter' && <PresentPanel room={follow.room} followers={follow.followers} onClose={() => setCode(false)} />}
    </nav>
  )
}
