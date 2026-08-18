import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

// Design system fonts, self-hosted via @fontsource so the app keeps working
// offline — a CDN <link> would break the local-first guarantee. Only the
// weights the type scale actually uses: Chakra Petch 400/600 (body, headings,
// nav) and IBM Plex Mono 400/600 (chrome, data, labels).
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'

import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
