import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The site's colors and the shared pieces (tabs, "Share this plan") come from the main styles; the
// Planner's own look is in planner.css.
import '../index.css'
import './planner.css'
import './planner-brief.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { PlannerApp } from './PlannerApp'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <PlannerApp />
    </AppErrorBoundary>
  </StrictMode>,
)
