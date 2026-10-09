import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppLockGate } from './AppLockGate'
import { ErrorBoundary } from './ErrorBoundary'
import { useAppStore } from './store/app-store'
import './design/tokens.css'
import './design/theme-miami.css'
import { applyTheme, cachedTheme } from './theme'

/**
 * A handle on the store, for the devtools console and for the smoke test.
 *
 * Nexus is one local application with no network and no untrusted script in
 * the page, so this exposes nothing the page could not already reach — it just
 * saves fishing the store out of a React fibre when you want to look at what
 * the app thinks is true.
 */
declare global {
  interface Window {
    nexus: { store: typeof useAppStore }
  }
}
window.nexus = { store: useAppStore }

// The theme is a setting in the vault, which loads after the first paint;
// the copy kept in this window's storage is applied now so the app doesn't
// flash the default look on the way in.
applyTheme(cachedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppLockGate>
        <App />
      </AppLockGate>
    </ErrorBoundary>
  </StrictMode>
)
