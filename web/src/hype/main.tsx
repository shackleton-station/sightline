import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The site's colors and the tabs come from the main styles; the page's own look is in hype.css.
import '../index.css'
import './hype.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { HypePage } from './HypePage'

watchForStaleBuild()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <HypePage />
    </AppErrorBoundary>
  </StrictMode>,
)
