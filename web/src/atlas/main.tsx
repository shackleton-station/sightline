import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The Atlas reuses Scout's guide and the time river, so it brings their styles and adds its own.
import '../index.css'
import '../shell/shell.css'
import '../scout/scout.css'
import './atlas.css'
// Each look's two fonts, self-hosted, Latin only (docs/ATLAS_LOOKS.md). A browser downloads a font file
// only when the page uses it, so a visitor in look A never fetches B's.
import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/chakra-petch/latin-400.css'
import '@fontsource/chakra-petch/latin-600.css'
import '@fontsource/chakra-petch/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/sora/latin-300.css'
import '@fontsource/sora/latin-400.css'
import '@fontsource/sora/latin-600.css'
import '@fontsource/dm-mono/latin-400.css'
import '@fontsource/dm-mono/latin-500.css'
import './atlas-looks.css'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { watchForStaleBuild } from '../data/staleBuild'
import { AtlasApp } from './AtlasApp'
import { listenForHype } from '../components/listenForHype'

watchForStaleBuild()

// The easter egg: typing its name anywhere on the site opens the Hype page.
listenForHype()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AtlasApp />
    </AppErrorBoundary>
  </StrictMode>,
)
