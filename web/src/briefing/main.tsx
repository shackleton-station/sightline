import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The briefing plays on the Atlas's picture with Scout as its voice, so it brings their styles and adds its own.
import '../index.css'
import '../shell/shell.css'
import '../scout/scout.css'
import '../atlas/atlas.css'
import './briefing.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { BriefingPage } from './BriefingPage'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BriefingPage />
    </AppErrorBoundary>
  </StrictMode>,
)
