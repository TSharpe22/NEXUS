import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as db from './database'
import * as io from './io'

function rethrowIpcError(channel: string, error: unknown): never {
  console.error(channel, error)
  const message = error instanceof Error ? error.message : String(error)
  const err = new Error(`[${channel}] ${message}`)
  ;(err as Error & { code: string }).code = 'NEXUS_IPC_ERROR'
  throw err
}

export function registerIpcHandlers(): void {
  // Pages
  ipcMain.handle('pages:create', () => {
    try { return db.createPage() }
    catch (e) { rethrowIpcError('pages:create', e) }
  })

  ipcMain.handle('pages:getAll', () => {
    try { return db.getAllPages() }
    catch (e) { rethrowIpcError('pages:getAll', e) }
  })

  ipcMain.handle('pages:getById', (_, id: string) => {
    try { return db.getPageById(id) }
    catch (e) { rethrowIpcError('pages:getById', e) }
  })

  ipcMain.handle('pages:update', (_, id: string, data: Record<string, unknown>) => {
    try { return db.updatePage(id, data) }
    catch (e) { rethrowIpcError('pages:update', e) }
  })

  ipcMain.handle('pages:softDelete', (_, id: string) => {
    try { return db.softDeletePage(id) }
    catch (e) { rethrowIpcError('pages:softDelete', e) }
  })

  ipcMain.handle('pages:restore', (_, id: string) => {
    try { return db.restorePage(id) }
    catch (e) { rethrowIpcError('pages:restore', e) }
  })

  ipcMain.handle('pages:hardDelete', (_, id: string) => {
    try { return db.hardDeletePage(id) }
    catch (e) { rethrowIpcError('pages:hardDelete', e) }
  })

  ipcMain.handle('pages:getDeleted', () => {
    try { return db.getDeletedPages() }
    catch (e) { rethrowIpcError('pages:getDeleted', e) }
  })

  ipcMain.handle('pages:duplicate', (_, id: string) => {
    try { return db.duplicatePage(id) }
    catch (e) { rethrowIpcError('pages:duplicate', e) }
  })

  // Blocks
  ipcMain.handle('blocks:getByPageId', (_, pageId: string) => {
    try { return db.getBlocksByPageId(pageId) }
    catch (e) { rethrowIpcError('blocks:getByPageId', e) }
  })

  ipcMain.handle('blocks:save', (_, pageId: string, blocks: unknown[]) => {
    try {
      if (!Array.isArray(blocks)) {
        throw new Error('Invalid blocks payload')
      }
      return db.saveBlocks(pageId, blocks as any)
    }
    catch (e) { rethrowIpcError('blocks:save', e) }
  })

  // Links
  ipcMain.handle('links:getBacklinks', (_, pageId: string) => {
    try { return db.getBacklinks(pageId) }
    catch (e) { rethrowIpcError('links:getBacklinks', e) }
  })

  ipcMain.handle('links:syncLinks', (_, pageId: string, linkTargets: unknown[]) => {
    try {
      if (!Array.isArray(linkTargets)) {
        throw new Error('Invalid linkTargets payload')
      }
      return db.syncLinks(pageId, linkTargets as any)
    }
    catch (e) { rethrowIpcError('links:syncLinks', e) }
  })

  // IO — Export
  ipcMain.handle('io:exportPageMarkdown', (_, pageId: string) => {
    try { return io.exportPageMarkdown(pageId) }
    catch (e) { rethrowIpcError('io:exportPageMarkdown', e) }
  })

  ipcMain.handle('io:exportPageJSON', (_, pageId: string) => {
    try { return io.exportPageJSON(pageId) }
    catch (e) { rethrowIpcError('io:exportPageJSON', e) }
  })

  ipcMain.handle('io:exportAllMarkdown', () => {
    try { return io.exportAllMarkdown() }
    catch (e) { rethrowIpcError('io:exportAllMarkdown', e) }
  })

  ipcMain.handle('io:exportAllJSON', () => {
    try { return io.exportAllJSON() }
    catch (e) { rethrowIpcError('io:exportAllJSON', e) }
  })

  // IO — Import
  ipcMain.handle('io:importMarkdown', (_, content: string, filename: string) => {
    try { return io.importMarkdown(content, filename) }
    catch (e) { rethrowIpcError('io:importMarkdown', e) }
  })

  ipcMain.handle('io:importJSON', (_, content: string) => {
    try { return io.importJSON(content) }
    catch (e) { rethrowIpcError('io:importJSON', e) }
  })

  ipcMain.handle('io:importPlainText', (_, content: string, filename: string) => {
    try { return io.importPlainText(content, filename) }
    catch (e) { rethrowIpcError('io:importPlainText', e) }
  })

  // Dialog
  ipcMain.handle('dialog:showSaveDialog', async (_, options: any) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, options)
    return result.canceled ? null : result.filePath || null
  })

  ipcMain.handle('dialog:showOpenDialog', async (_, options: any) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, options)
    return result.canceled ? null : result.filePaths || null
  })

  ipcMain.handle('dialog:showSelectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths?.[0] || null
  })

  // File reading/writing helpers for the renderer
  ipcMain.handle('fs:readFile', (_, filePath: string) => {
    try { return readFileSync(filePath, 'utf-8') }
    catch (e) { rethrowIpcError('fs:readFile', e) }
  })

  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string) => {
    try { writeFileSync(filePath, content, 'utf-8') }
    catch (e) { rethrowIpcError('fs:writeFile', e) }
  })

  ipcMain.handle('fs:writeFiles', (_, folder: string, files: { filename: string; content: string }[]) => {
    try {
      mkdirSync(folder, { recursive: true })
      for (const file of files) {
        writeFileSync(join(folder, file.filename), file.content, 'utf-8')
      }
    }
    catch (e) { rethrowIpcError('fs:writeFiles', e) }
  })
}
