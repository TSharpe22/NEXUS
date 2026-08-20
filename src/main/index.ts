import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { ensureSearchIndex, ensureTaskIndex, ensureLinkIndex } from './repo'
import { flushPending as flushMirror } from './mirror'
import { flushRenderer } from './flush'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#121316',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())

  // A window closes in two steps now: the first `close` is held back while the
  // renderer writes out whatever it still has pending, and the second — after
  // `flushed` is set — is allowed through. Without this the window is gone
  // before the flush lands, which is the whole reason an edit typed inside the
  // debounce window used to disappear on quit.
  let flushed = false
  let flushing = false
  win.on('close', (event) => {
    if (flushed) return
    event.preventDefault()
    if (flushing) return
    flushing = true
    void flushRenderer(win).finally(() => {
      flushed = true
      win.close()
    })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// One Nexus per vault. A second launch used to open its own window against the
// same database file, each process holding its own renderer-side document
// cache — so whichever saved last won, and the other window's next keystroke
// wrote its stale copy back over the top. WAL keeps the file intact; it cannot
// keep two editors from disagreeing about what a page says.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    initDatabase()
    // The v4 migration creates page_fts empty; fill it before the first query.
    ensureSearchIndex()
    // Same for v8's `tasks` — every checkbox written before the tracker existed
    // is picked up here, once.
    ensureTaskIndex()
    // v9 drops `links` to rebuild it with a source discriminator; this refills
    // it from both the documents and the relation properties.
    ensureLinkIndex()
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// Closing the last window is not the same as quitting. Tearing the database
// down here left `activate` re-creating a window against a closed handle, so
// every query threw; on platforms that do quit, the shutdown below runs anyway
// and is the one place that has to close things.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// `will-quit`, not `before-quit`. `before-quit` fires *first*, ahead of the
// windows closing — so closing the database there meant the flush a window
// sends on its way out arrived at a closed handle and was rejected, silently,
// into a renderer that was already being torn down. `will-quit` runs after
// every window has gone, which is after every flush has been waited for.
app.on('will-quit', () => {
  // Flush before the database closes — the mirror reads from it.
  flushMirror()
  closeDatabase()
})
