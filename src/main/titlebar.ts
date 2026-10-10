import { BrowserWindow } from 'electron'
import type { Theme } from '@shared/types'

/**
 * The window frame, drawn by Nexus instead of the desktop.
 *
 * On Linux and Windows the system title bar and the File/Edit/View menu bar
 * are hidden; the minimise/maximise/close buttons are drawn by Electron over
 * the top-right corner of the page (the "title bar overlay"), painted in the
 * theme's colours. The page's top bar is the drag handle (App.css,
 * .nx-topbar) and is exactly this tall so the buttons sit inside it.
 * macOS keeps its traffic lights (hiddenInset) and is untouched.
 */
export const TITLEBAR_HEIGHT = 49

export const usesOverlay = process.platform !== 'darwin'

// Mirrors --nx-bg and --nx-text-muted in tokens.css and theme-miami.css.
const COLORS: Record<Theme, { color: string; symbolColor: string }> = {
  default: { color: '#0f110f', symbolColor: '#9aa19c' },
  miami: { color: '#0c0a1c', symbolColor: '#aca5d8' }
}

export function overlayFor(theme: Theme): Electron.TitleBarOverlay {
  return { ...COLORS[theme], height: TITLEBAR_HEIGHT }
}

export function applyTitleBarTheme(theme: Theme): void {
  if (!usesOverlay) return
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setTitleBarOverlay(overlayFor(theme))
    } catch {
      // A window without an overlay (or a platform without the API) keeps
      // whatever it has; a frame colour is not worth an error.
    }
  }
}
