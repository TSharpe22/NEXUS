import { globalShortcut, type BrowserWindow } from 'electron'

/**
 * The system-wide key that opens the capture box.
 *
 * The single action Nexus exists for is getting a thought down before it goes,
 * and until this existed that cost finding the window first. It is also the
 * one thing in the application that reaches outside it, so three rules apply:
 * it is **off unless asked for**, it is **spelled by the user** rather than
 * hardcoded to a combination some other application already owns, and **a
 * failed registration is reported** — a setting that claims to be on over a key
 * that does nothing is worse than one that admits it.
 *
 * Its own module rather than a corner of `index.ts` because `ipc.ts` has to
 * reach it, and importing `index.ts` from `ipc.ts` — which `index.ts` imports —
 * is a cycle whose failure mode is an undefined function at startup.
 */

let registered = ''
let target: (() => BrowserWindow | null) | null = null

/** Where to send the request. Set once, when the window is made. */
export function setCaptureTarget(getWindow: () => BrowserWindow | null): void {
  target = getWindow
}

export function captureAcceleratorActive(): boolean {
  return registered !== '' && globalShortcut.isRegistered(registered)
}

export function applyCaptureAccelerator(accelerator: string): boolean {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = ''
  }

  const wanted = accelerator.trim()
  if (!wanted) return false

  try {
    const took = globalShortcut.register(wanted, () => {
      const win = target?.() ?? null
      if (!win || win.isDestroyed()) return
      // Brought forward first: the accelerator fires whether or not Nexus is
      // the focused application, and a capture box behind three other windows
      // is a keystroke that went nowhere.
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('app:capture')
    })
    if (took) registered = wanted
    return took
  } catch (err) {
    // An accelerator Electron cannot parse throws rather than returning false.
    console.error('[nexus] could not register the capture key:', err)
    return false
  }
}

/** Electron holds a registered key for the life of the process. */
export function releaseCaptureAccelerator(): void {
  globalShortcut.unregisterAll()
  registered = ''
}
