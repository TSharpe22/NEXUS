import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as repo from './repo'
import * as io from './io'
import type { PropertyType, LinkTarget } from '../shared/types'

function rethrow(channel: string, error: unknown): never {
  console.error(channel, error)
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`[${channel}] ${message}`)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('pages:create', (_, typeId?: string) => {
    try {
      return repo.createPage(typeId)
    } catch (e) {
      rethrow('pages:create', e)
    }
  })
  ipcMain.handle('pages:getAll', () => {
    try {
      return repo.getAllPages()
    } catch (e) {
      rethrow('pages:getAll', e)
    }
  })
  ipcMain.handle('pages:getAllSummary', (_, typeId?: string) => {
    try {
      return repo.getPagesSummary(typeId)
    } catch (e) {
      rethrow('pages:getAllSummary', e)
    }
  })
  ipcMain.handle('pages:getById', (_, id: string) => {
    try {
      return repo.getPageById(id)
    } catch (e) {
      rethrow('pages:getById', e)
    }
  })
  ipcMain.handle('pages:update', (_, id: string, data: Record<string, unknown>) => {
    try {
      return repo.updatePage(id, data)
    } catch (e) {
      rethrow('pages:update', e)
    }
  })
  ipcMain.handle('pages:softDelete', (_, id: string) => {
    try {
      return repo.softDeletePage(id)
    } catch (e) {
      rethrow('pages:softDelete', e)
    }
  })
  ipcMain.handle('pages:restore', (_, id: string) => {
    try {
      return repo.restorePage(id)
    } catch (e) {
      rethrow('pages:restore', e)
    }
  })
  ipcMain.handle('pages:hardDelete', (_, id: string) => {
    try {
      return repo.hardDeletePage(id)
    } catch (e) {
      rethrow('pages:hardDelete', e)
    }
  })
  ipcMain.handle('pages:getDeleted', () => {
    try {
      return repo.getDeletedPages()
    } catch (e) {
      rethrow('pages:getDeleted', e)
    }
  })
  ipcMain.handle('pages:duplicate', (_, id: string) => {
    try {
      return repo.duplicatePage(id)
    } catch (e) {
      rethrow('pages:duplicate', e)
    }
  })

  ipcMain.handle('properties:getForPage', (_, pageId: string) => {
    try {
      return repo.getPropertiesForPage(pageId)
    } catch (e) {
      rethrow('properties:getForPage', e)
    }
  })
  ipcMain.handle(
    'properties:set',
    (_, pageId: string, key: string, type: PropertyType, value: string | number | null) => {
      try {
        return repo.setProperty(pageId, key, type, value)
      } catch (e) {
        rethrow('properties:set', e)
      }
    }
  )
  ipcMain.handle('properties:remove', (_, pageId: string, key: string) => {
    try {
      return repo.removeProperty(pageId, key)
    } catch (e) {
      rethrow('properties:remove', e)
    }
  })

  ipcMain.handle('types:list', () => {
    try {
      return repo.getTypes()
    } catch (e) {
      rethrow('types:list', e)
    }
  })
  ipcMain.handle('types:create', (_, name: string, icon?: string) => {
    try {
      return repo.createType(name, icon ?? null)
    } catch (e) {
      rethrow('types:create', e)
    }
  })
  ipcMain.handle('types:getPropertyDefinitions', (_, typeId: string) => {
    try {
      return repo.getPropertyDefinitions(typeId)
    } catch (e) {
      rethrow('types:getPropertyDefinitions', e)
    }
  })
  ipcMain.handle('types:defineProperty', (_, typeId: string, name: string, propertyType: PropertyType) => {
    try {
      return repo.defineProperty(typeId, name, propertyType)
    } catch (e) {
      rethrow('types:defineProperty', e)
    }
  })

  ipcMain.handle('links:getBacklinks', (_, pageId: string) => {
    try {
      return repo.getBacklinks(pageId)
    } catch (e) {
      rethrow('links:getBacklinks', e)
    }
  })
  ipcMain.handle('links:syncLinks', (_, pageId: string, linkTargets: LinkTarget[]) => {
    try {
      return repo.syncLinks(pageId, linkTargets)
    } catch (e) {
      rethrow('links:syncLinks', e)
    }
  })
  ipcMain.handle('links:searchPages', (_, query: string) => {
    try {
      return repo.searchPagesForLink(query)
    } catch (e) {
      rethrow('links:searchPages', e)
    }
  })

  ipcMain.handle('activity:getRecent', (_, limit?: number) => {
    try {
      return repo.getRecentActivity(limit)
    } catch (e) {
      rethrow('activity:getRecent', e)
    }
  })

  ipcMain.handle('stats:getStorage', () => {
    try {
      return repo.getStorageStats()
    } catch (e) {
      rethrow('stats:getStorage', e)
    }
  })
  ipcMain.handle('stats:getGraphPreview', () => {
    try {
      return repo.getGraphPreview()
    } catch (e) {
      rethrow('stats:getGraphPreview', e)
    }
  })

  ipcMain.handle('io:exportPageMarkdown', (_, pageId: string) => {
    try {
      return io.exportPageMarkdown(pageId)
    } catch (e) {
      rethrow('io:exportPageMarkdown', e)
    }
  })
  ipcMain.handle('io:exportPageJSON', (_, pageId: string) => {
    try {
      return io.exportPageJSON(pageId)
    } catch (e) {
      rethrow('io:exportPageJSON', e)
    }
  })
  ipcMain.handle('io:exportAllMarkdown', () => {
    try {
      return io.exportAllMarkdown()
    } catch (e) {
      rethrow('io:exportAllMarkdown', e)
    }
  })
  ipcMain.handle('io:importMarkdown', (_, content: string, filename: string) => {
    try {
      return io.importMarkdown(content, filename)
    } catch (e) {
      rethrow('io:importMarkdown', e)
    }
  })
  ipcMain.handle('io:importJSON', (_, content: string) => {
    try {
      return io.importJSON(content)
    } catch (e) {
      rethrow('io:importJSON', e)
    }
  })

  ipcMain.handle('dialog:showSaveDialog', async (_, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, options)
    return result.canceled ? null : result.filePath || null
  })
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, options)
    return result.canceled ? null : result.filePaths || null
  })
  ipcMain.handle('dialog:showSelectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths?.[0] || null
  })

  ipcMain.handle('fs:readFile', (_, filePath: string) => {
    try {
      return readFileSync(filePath, 'utf-8')
    } catch (e) {
      rethrow('fs:readFile', e)
    }
  })
  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8')
    } catch (e) {
      rethrow('fs:writeFile', e)
    }
  })
  ipcMain.handle('fs:writeFiles', (_, folder: string, files: { filename: string; content: string }[]) => {
    try {
      mkdirSync(folder, { recursive: true })
      for (const file of files) {
        writeFileSync(join(folder, file.filename), file.content, 'utf-8')
      }
    } catch (e) {
      rethrow('fs:writeFiles', e)
    }
  })
}
