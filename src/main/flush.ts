import { BrowserWindow, ipcMain } from 'electron'

/**
 * Getting a renderer's pending writes onto disk, and waiting for them.
 *
 * The editor debounces a save by 600ms, so at any moment the newest keystrokes
 * may exist only in the renderer. Its handler does issue them, but
 * `pages:update` is an async `invoke` — so the write has to be *waited for* by
 * something on this side that is still holding the window open. Anything that
 * closes the window, or closes the database, without waiting is racing the last
 * thing the user typed.
 *
 * Its own module because both of the things that have to wait live elsewhere:
 * the window's `close` handler in `index.ts`, and restoring a snapshot in
 * `ipc.ts`, which replaces the database file under everyone.
 */

/**
 * How long a renderer gets. Long enough for an autosave round trip, short
 * enough that a hung or crashed one cannot make the app unquittable.
 */
export const FLUSH_TIMEOUT_MS = 2000

export function flushRenderer(win: BrowserWindow): Promise<void> {
  const contents = win.webContents
  if (contents.isDestroyed() || contents.isCrashed()) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.removeListener('app:flushed', onFlushed)
      resolve()
    }
    const onFlushed = (event: Electron.IpcMainEvent): void => {
      if (event.sender === contents) finish()
    }
    const timer = setTimeout(finish, FLUSH_TIMEOUT_MS)

    ipcMain.on('app:flushed', onFlushed)
    contents.send('app:flush')
  })
}

/** Every open window, in parallel. */
export function flushAllRenderers(): Promise<void[]> {
  return Promise.all(BrowserWindow.getAllWindows().map(flushRenderer))
}
