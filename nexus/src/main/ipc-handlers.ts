import { ipcMain } from 'electron'
import * as db from './database'

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
}
