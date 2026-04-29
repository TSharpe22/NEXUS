import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { initDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'

function logFilePath(): string {
  const dir = join(app.getPath('userData'), 'data')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return join(dir, 'nexus.log')
}

function logError(scope: string, err: unknown): void {
  const timestamp = new Date().toISOString()
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  const line = `[${timestamp}] ${scope}: ${detail}\n`
  try {
    appendFileSync(logFilePath(), line)
  } catch {
    /* nothing left to do */
  }
}

let mainWindow: BrowserWindow | null = null
let didFlushBeforeQuit = false

// Ask the renderer to drain debounced writes, with a hard timeout so a wedged
// renderer can't block app exit indefinitely.
function flushRendererPending(timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve()
    const requestId = randomUUID()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      ipcMain.removeListener('lifecycle:flush-ack', listener)
      resolve()
    }
    const listener = (_e: unknown, id: string) => {
      if (id === requestId) finish()
    }
    ipcMain.on('lifecycle:flush-ack', listener)
    mainWindow.webContents.send('lifecycle:flush-pending', requestId)
    setTimeout(finish, timeoutMs)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0a0a0c',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Graceful show after ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ============================================================
// App lifecycle
// ============================================================

app.whenReady().then(() => {
  try {
    initDatabase()
  } catch (err) {
    const dbPath = join(app.getPath('userData'), 'data', 'nexus.db')
    const message = err instanceof Error ? err.message : String(err)
    logError('initDatabase', err)
    dialog.showErrorBox(
      'Nexus could not start',
      `The local database could not be opened.\n\nPath: ${dbPath}\n\n${message}`
    )
    app.exit(1)
    return
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (e) => {
  if (didFlushBeforeQuit) return
  e.preventDefault()
  didFlushBeforeQuit = true
  await flushRendererPending()
  closeDatabase()
  app.exit(0)
})
