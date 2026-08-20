import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as repo from './repo'
import * as io from './io'
import * as mirror from './mirror'
import { getDataDir, getBackupInfo } from './database'
import type { PropertyType, CaptureTarget } from '../shared/types'

/**
 * File dialogs, parented to a window when there is one.
 *
 * Any window will do; what matters is not bailing out when none is *focused*.
 * Every caller reads a null result as "the user cancelled", so a momentarily
 * unfocused window made Import, Export and the mirror folder picker silently
 * do nothing at all.
 */
function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function openDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const win = dialogParent()
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

function saveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  const win = dialogParent()
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

function rethrow(channel: string, error: unknown): never {
  console.error(channel, error)
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`[${channel}] ${message}`)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('pages:create', (_, typeId?: string) => {
    try {
      const page = repo.createPage(typeId)
      // Scheduled here rather than in a `finally`, because the id of a page
      // that has just been created is only in the return value. Naming it is
      // what keeps a new page off the mirror's whole-vault path.
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('pages:create', e)
    }
  })
  ipcMain.handle('journal:today', () => {
    try {
      const page = repo.getOrCreateTodayEntry()
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('journal:today', e)
    }
  })
  ipcMain.handle('journal:peek', () => {
    try {
      return repo.getTodayEntry()
    } catch (e) {
      rethrow('journal:peek', e)
    }
  })
  ipcMain.handle('types:setTemplate', (_, typeId: string, pageId: string | null) => {
    try {
      return repo.setTypeTemplate(typeId, pageId ?? null)
    } catch (e) {
      rethrow('types:setTemplate', e)
    }
  })
  ipcMain.handle('types:getTemplate', (_, typeId: string) => {
    try {
      return repo.getTypeTemplate(typeId)
    } catch (e) {
      rethrow('types:getTemplate', e)
    }
  })
  ipcMain.handle('mirror:getConfig', () => {
    try {
      return mirror.getConfig()
    } catch (e) {
      rethrow('mirror:getConfig', e)
    }
  })
  ipcMain.handle('mirror:setFolder', (_, folder: string | null) => {
    try {
      return mirror.setFolder(folder || null)
    } catch (e) {
      rethrow('mirror:setFolder', e)
    }
  })
  ipcMain.handle('mirror:setEnabled', (_, enabled: boolean) => {
    try {
      return mirror.setEnabled(Boolean(enabled))
    } catch (e) {
      rethrow('mirror:setEnabled', e)
    }
  })
  ipcMain.handle('mirror:syncNow', () => {
    try {
      return mirror.syncNow()
    } catch (e) {
      rethrow('mirror:syncNow', e)
    }
  })
  ipcMain.handle('search:pages', (_, query: string, limit?: number) => {
    try {
      return repo.searchPages(String(query ?? ''), limit ?? 50)
    } catch (e) {
      rethrow('search:pages', e)
    }
  })
  ipcMain.handle('search:rebuildIndex', () => {
    try {
      return repo.rebuildSearchIndex()
    } catch (e) {
      rethrow('search:rebuildIndex', e)
    }
  })
  ipcMain.handle('pages:getAll', () => {
    try {
      return repo.getAllPages()
    } catch (e) {
      rethrow('pages:getAll', e)
    }
  })
  ipcMain.handle('pages:list', () => {
    try {
      return repo.getPageList()
    } catch (e) {
      rethrow('pages:list', e)
    }
  })
  ipcMain.handle('pages:listDeleted', () => {
    try {
      return repo.getDeletedPageList()
    } catch (e) {
      rethrow('pages:listDeleted', e)
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
      const result = repo.updatePage(id, data)
      mirror.scheduleSync(id)
      return result
    } catch (e) {
      rethrow('pages:update', e)
    }
  })
  ipcMain.handle('pages:softDelete', (_, id: string) => {
    try {
      const result = repo.softDeletePage(id)
      mirror.scheduleSync(id)
      return result
    } catch (e) {
      rethrow('pages:softDelete', e)
    }
  })
  ipcMain.handle('pages:restore', (_, id: string) => {
    try {
      const result = repo.restorePage(id)
      mirror.scheduleSync(id)
      return result
    } catch (e) {
      rethrow('pages:restore', e)
    }
  })
  ipcMain.handle('pages:hardDelete', (_, id: string) => {
    try {
      const result = repo.hardDeletePage(id)
      mirror.scheduleSync(id)
      return result
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
      const page = repo.duplicatePage(id)
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('pages:duplicate', e)
    }
  })
  // No `mirror.scheduleSync` here. A pin is not part of what the mirror
  // writes — it appears in no frontmatter field — and pinning deliberately
  // leaves `updated_at` alone, so there is nothing on disk that went stale.
  //
  // There is no read channel to match: `pages:list` already carries
  // `is_pinned` and `pinned_at`, so Home reads both from the one page list
  // the store holds rather than fetching its own copy.
  ipcMain.handle('pages:setPinned', (_, id: string, pinned: boolean) => {
    try {
      return repo.setPagePinned(id, pinned)
    } catch (e) {
      rethrow('pages:setPinned', e)
    }
  })
  ipcMain.handle('capture:line', (_, text: string, target: CaptureTarget) => {
    try {
      const page = repo.capture(text, target)
      // A capture writes a document, so the mirror does have work to do —
      // named, since exactly one page changed.
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('capture:line', e)
    }
  })
  ipcMain.handle('pages:setType', (_, pageId: string, typeId: string) => {
    try {
      const result = repo.setPageType(pageId, typeId)
      mirror.scheduleSync(pageId)
      return result
    } catch (e) {
      rethrow('pages:setType', e)
    }
  })
  ipcMain.handle('pages:emptyTrash', () => {
    try {
      const result = repo.emptyTrash()
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('pages:emptyTrash', e)
    }
  })

  ipcMain.handle('pages:move', (_, id: string, folderId: string | null) => {
    try {
      const result = repo.movePageToFolder(id, folderId)
      mirror.scheduleSync(id)
      return result
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
      const result = repo.createFolder(name, parentFolderId)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('folders:create', e)
    }
  })
  ipcMain.handle('folders:rename', (_, id: string, name: string) => {
    try {
      const result = repo.renameFolder(id, name)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('folders:rename', e)
    }
  })
  ipcMain.handle('folders:move', (_, id: string, parentFolderId: string | null) => {
    try {
      const result = repo.moveFolder(id, parentFolderId)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('folders:move', e)
    }
  })
  ipcMain.handle('folders:remove', (_, id: string) => {
    try {
      const result = repo.deleteFolder(id)
      mirror.scheduleSync()
      return result
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
      const result = repo.addTagToPage(pageId, name)
      mirror.scheduleSync(pageId)
      return result
    } catch (e) {
      rethrow('tags:addToPage', e)
    }
  })
  ipcMain.handle('tags:removeFromPage', (_, pageId: string, tagId: string) => {
    try {
      const result = repo.removeTagFromPage(pageId, tagId)
      mirror.scheduleSync(pageId)
      return result
    } catch (e) {
      rethrow('tags:removeFromPage', e)
    }
  })
  ipcMain.handle('tags:rename', (_, id: string, name: string) => {
    try {
      const result = repo.renameTag(id, name)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('tags:rename', e)
    }
  })
  ipcMain.handle('tags:remove', (_, id: string) => {
    try {
      const result = repo.deleteTag(id)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('tags:remove', e)
    }
  })
  ipcMain.handle('tags:setColor', (_, id: string, color: string) => {
    try {
      const result = repo.setTagColor(id, color)
      mirror.scheduleSync()
      return result
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
        const result = repo.setProperty(pageId, key, type, value)
        mirror.scheduleSync(pageId)
        return result
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
      const result = repo.removeProperty(pageId, key)
      mirror.scheduleSync(pageId)
      return result
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
      const result = repo.createType(name, icon ?? null)
      mirror.scheduleSync()
      return result
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
      const result = repo.defineProperty(typeId, name, propertyType)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('types:defineProperty', e)
    }
  })
  ipcMain.handle('types:rename', (_, id: string, name: string) => {
    try {
      const result = repo.renameType(id, name)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('types:rename', e)
    }
  })
  ipcMain.handle('types:remove', (_, id: string) => {
    try {
      const result = repo.deleteType(id)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('types:remove', e)
    }
  })
  ipcMain.handle('types:renameProperty', (_, definitionId: string, name: string) => {
    try {
      const result = repo.renamePropertyDefinition(definitionId, name)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('types:renameProperty', e)
    }
  })
  ipcMain.handle('types:reorderProperties', (_, typeId: string, orderedIds: string[]) => {
    try {
      const result = repo.reorderPropertyDefinitions(typeId, orderedIds)
      mirror.scheduleSync()
      return result
    } catch (e) {
      rethrow('types:reorderProperties', e)
    }
  })

  ipcMain.handle('types:removeProperty', (_, definitionId: string) => {
    try {
      const result = repo.removePropertyDefinition(definitionId)
      mirror.scheduleSync()
      return result
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
  ipcMain.handle('links:searchPages', (_, query: string, excludePageId?: string) => {
    try {
      return repo.searchPagesForLink(query, excludePageId)
    } catch (e) {
      rethrow('links:searchPages', e)
    }
  })

  ipcMain.handle('habits:candidates', () => {
    try {
      return repo.getHabitCandidates()
    } catch (e) {
      rethrow('habits:candidates', e)
    }
  })
  ipcMain.handle(
    'habits:days',
    (_, typeId: string, dateKey: string, booleanKey: string, from: string, to: string) => {
      try {
        return repo.getHabitDays(typeId, dateKey, booleanKey, String(from), String(to))
      } catch (e) {
        rethrow('habits:days', e)
      }
    }
  )
  ipcMain.handle('tasks:inRange', (_, from: string, to: string) => {
    try {
      return repo.getTasksInRange(String(from), String(to))
    } catch (e) {
      rethrow('tasks:inRange', e)
    }
  })
  ipcMain.handle('tasks:overdue', (_, before: string) => {
    try {
      return repo.getOverdueTasks(String(before))
    } catch (e) {
      rethrow('tasks:overdue', e)
    }
  })
  ipcMain.handle('tasks:undated', (_, limit?: number) => {
    try {
      return repo.getUndatedTasks(limit ?? 100)
    } catch (e) {
      rethrow('tasks:undated', e)
    }
  })
  ipcMain.handle('tasks:forPage', (_, pageId: string) => {
    try {
      return repo.getTasksForPage(pageId)
    } catch (e) {
      rethrow('tasks:forPage', e)
    }
  })
  ipcMain.handle('tasks:datedPages', (_, from: string, to: string) => {
    try {
      return repo.getDatedPagesInRange(String(from), String(to))
    } catch (e) {
      rethrow('tasks:datedPages', e)
    }
  })
  ipcMain.handle('tasks:setDone', (_, pageId: string, blockId: string, done: boolean) => {
    try {
      const result = repo.setTaskDone(pageId, blockId, Boolean(done))
      // Ticking a task rewrites the page's body, so the mirror is stale until
      // it re-runs — the same reason every other page write schedules one.
      mirror.scheduleSync(pageId)
      return result
    } catch (e) {
      rethrow('tasks:setDone', e)
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

  ipcMain.handle('stats:getBackups', () => {
    try {
      return getBackupInfo()
    } catch (e) {
      rethrow('stats:getBackups', e)
    }
  })
  ipcMain.handle('shell:openPath', async (_, target: string) => {
    try {
      // Returns a message on failure rather than throwing, which is how a
      // missing folder or no file manager comes back.
      const problem = await shell.openPath(target)
      return problem || null
    } catch (e) {
      rethrow('shell:openPath', e)
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
      const page = io.importMarkdown(content, filename)
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('io:importMarkdown', e)
    }
  })
  ipcMain.handle('io:importJSON', (_, content: string) => {
    try {
      const page = io.importJSON(content)
      mirror.scheduleSync(page.id)
      return page
    } catch (e) {
      rethrow('io:importJSON', e)
    }
  })

  ipcMain.handle('dialog:showSaveDialog', async (_, options) => {
    const result = await saveDialog(options)
    return result.canceled ? null : result.filePath || null
  })
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    const result = await openDialog(options)
    return result.canceled ? null : result.filePaths || null
  })
  ipcMain.handle('dialog:showSelectFolder', async () => {
    const result = await openDialog({ properties: ['openDirectory', 'createDirectory'] })
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
