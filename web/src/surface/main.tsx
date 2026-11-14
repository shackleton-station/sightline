import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The Surface tab reuses the time river and the flat horizon chart, so it brings their styles and adds its own.
import '../index.css'
import '../shell/shell.css'
import './surface.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { SurfaceApp } from './SurfaceApp'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <SurfaceApp />
    </AppErrorBoundary>
  </StrictMode>,
)
