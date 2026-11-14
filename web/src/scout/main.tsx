import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The Moon and terrain views bring their own styles from the main site; Scout's look is in scout.css.
import '../index.css'
import '../shell/shell.css'
import './scout.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { ScoutApp } from './ScoutApp'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ScoutApp />
    </AppErrorBoundary>
  </StrictMode>,
)
