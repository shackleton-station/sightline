import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The site's colors come from the main styles; the page's own look is in gpu.css.
import '../index.css'
import './gpu.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { GpuPage } from './GpuPage'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <GpuPage />
    </AppErrorBoundary>
  </StrictMode>,
)
