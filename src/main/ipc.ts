import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as repo from './repo'
import * as io from './io'
import { getDataDir } from './database'
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
  ipcMain.handle('pages:setType', (_, pageId: string, typeId: string) => {
    try {
      return repo.setPageType(pageId, typeId)
    } catch (e) {
      rethrow('pages:setType', e)
    }
  })
  ipcMain.handle('pages:emptyTrash', () => {
    try {
      return repo.emptyTrash()
    } catch (e) {
      rethrow('pages:emptyTrash', e)
    }
  })

  ipcMain.handle('pages:move', (_, id: string, folderId: string | null) => {
    try {
      return repo.movePageToFolder(id, folderId)
    } catch (e) {
      rethrow('pages:move', e)
    }
  })

  // ---- Folders ----
  ipcMain.handle('folders:list', () => {
    try {
      return repo.getFolders()
    } catch (e) {
      rethrow('folders:list', e)
    }
  })
  ipcMain.handle('folders:create', (_, name: string, parentFolderId: string | null) => {
    try {
      return repo.createFolder(name, parentFolderId)
    } catch (e) {
      rethrow('folders:create', e)
    }
  })
  ipcMain.handle('folders:rename', (_, id: string, name: string) => {
    try {
      return repo.renameFolder(id, name)
    } catch (e) {
      rethrow('folders:rename', e)
    }
  })
  ipcMain.handle('folders:move', (_, id: string, parentFolderId: string | null) => {
    try {
      return repo.moveFolder(id, parentFolderId)
    } catch (e) {
      rethrow('folders:move', e)
    }
  })
  ipcMain.handle('folders:remove', (_, id: string) => {
    try {
      return repo.deleteFolder(id)
    } catch (e) {
      rethrow('folders:remove', e)
    }
  })

  // ---- Tags ----
  ipcMain.handle('tags:list', () => {
    try {
      return repo.getTags()
    } catch (e) {
      rethrow('tags:list', e)
    }
  })
  ipcMain.handle('tags:getForPage', (_, pageId: string) => {
    try {
      return repo.getTagsForPage(pageId)
    } catch (e) {
      rethrow('tags:getForPage', e)
    }
  })
  ipcMain.handle('tags:addToPage', (_, pageId: string, name: string) => {
    try {
      return repo.addTagToPage(pageId, name)
    } catch (e) {
      rethrow('tags:addToPage', e)
    }
  })
  ipcMain.handle('tags:removeFromPage', (_, pageId: string, tagId: string) => {
    try {
      return repo.removeTagFromPage(pageId, tagId)
    } catch (e) {
      rethrow('tags:removeFromPage', e)
    }
  })
  ipcMain.handle('tags:rename', (_, id: string, name: string) => {
    try {
      return repo.renameTag(id, name)
    } catch (e) {
      rethrow('tags:rename', e)
    }
  })
  ipcMain.handle('tags:remove', (_, id: string) => {
    try {
      return repo.deleteTag(id)
    } catch (e) {
      rethrow('tags:remove', e)
    }
  })
  ipcMain.handle('tags:setColor', (_, id: string, color: string) => {
    try {
      return repo.setTagColor(id, color)
    } catch (e) {
      rethrow('tags:setColor', e)
    }
  })
  ipcMain.handle('tags:pageIdsFor', (_, tagIds: unknown) => {
    try {
      if (!Array.isArray(tagIds)) throw new Error('tagIds must be an array')
      return repo.getPageIdsForTags(tagIds as string[])
    } catch (e) {
      rethrow('tags:pageIdsFor', e)
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
  ipcMain.handle('properties:knownValues', (_, key: string) => {
    try {
      return repo.getKnownPropertyValues(key)
    } catch (e) {
      rethrow('properties:knownValues', e)
    }
  })
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
  ipcMain.handle('types:rename', (_, id: string, name: string) => {
    try {
      return repo.renameType(id, name)
    } catch (e) {
      rethrow('types:rename', e)
    }
  })
  ipcMain.handle('types:remove', (_, id: string) => {
    try {
      return repo.deleteType(id)
    } catch (e) {
      rethrow('types:remove', e)
    }
  })
  ipcMain.handle('types:renameProperty', (_, definitionId: string, name: string) => {
    try {
      return repo.renamePropertyDefinition(definitionId, name)
    } catch (e) {
      rethrow('types:renameProperty', e)
    }
  })
  ipcMain.handle('types:removeProperty', (_, definitionId: string) => {
    try {
      return repo.removePropertyDefinition(definitionId)
    } catch (e) {
      rethrow('types:removeProperty', e)
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
  ipcMain.handle('links:searchPages', (_, query: string, excludePageId?: string) => {
    try {
      return repo.searchPagesForLink(query, excludePageId)
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
  ipcMain.handle('stats:getGraph', () => {
    try {
      return repo.getGraph()
    } catch (e) {
      rethrow('stats:getGraph', e)
    }
  })
  ipcMain.handle('stats:getDataDir', () => {
    try {
      return getDataDir()
    } catch (e) {
      rethrow('stats:getDataDir', e)
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
