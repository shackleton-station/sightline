import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The Moon brings its styles from the main site, the look is Scout's, and sightline.css lays the screen out.
import '../index.css'
import '../shell/shell.css'
import '../scout/scout.css'
import './sightline.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { SightlineApp } from './SightlineApp'

watchForStaleBuild()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <SightlineApp />
    </AppErrorBoundary>
  </StrictMode>,
)
