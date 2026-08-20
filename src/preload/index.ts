import { contextBridge, ipcRenderer } from 'electron'
import type { NexusAPI } from '../shared/types'

const api: NexusAPI = {
  journal: {
    today: () => ipcRenderer.invoke('journal:today'),
  },
  mirror: {
    getConfig: () => ipcRenderer.invoke('mirror:getConfig'),
    setFolder: (folder) => ipcRenderer.invoke('mirror:setFolder', folder),
    setEnabled: (enabled) => ipcRenderer.invoke('mirror:setEnabled', enabled),
    syncNow: () => ipcRenderer.invoke('mirror:syncNow'),
  },
  search: {
    pages: (query, limit) => ipcRenderer.invoke('search:pages', query, limit),
    rebuildIndex: () => ipcRenderer.invoke('search:rebuildIndex'),
  },
  pages: {
    create: (typeId) => ipcRenderer.invoke('pages:create', typeId),
    getAll: () => ipcRenderer.invoke('pages:getAll'),
    getAllSummary: (typeId) => ipcRenderer.invoke('pages:getAllSummary', typeId),
    getById: (id) => ipcRenderer.invoke('pages:getById', id),
    update: (id, data) => ipcRenderer.invoke('pages:update', id, data),
    setType: (pageId, typeId) => ipcRenderer.invoke('pages:setType', pageId, typeId),
    softDelete: (id) => ipcRenderer.invoke('pages:softDelete', id),
    restore: (id) => ipcRenderer.invoke('pages:restore', id),
    hardDelete: (id) => ipcRenderer.invoke('pages:hardDelete', id),
    getDeleted: () => ipcRenderer.invoke('pages:getDeleted'),
    emptyTrash: () => ipcRenderer.invoke('pages:emptyTrash'),
    duplicate: (id) => ipcRenderer.invoke('pages:duplicate', id),
    move: (id, folderId) => ipcRenderer.invoke('pages:move', id, folderId)
  },
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    create: (name, parentFolderId) => ipcRenderer.invoke('folders:create', name, parentFolderId),
    rename: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
    move: (id, parentFolderId) => ipcRenderer.invoke('folders:move', id, parentFolderId),
    remove: (id) => ipcRenderer.invoke('folders:remove', id)
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    getForPage: (pageId) => ipcRenderer.invoke('tags:getForPage', pageId),
    addToPage: (pageId, name) => ipcRenderer.invoke('tags:addToPage', pageId, name),
    removeFromPage: (pageId, tagId) => ipcRenderer.invoke('tags:removeFromPage', pageId, tagId),
    rename: (id, name) => ipcRenderer.invoke('tags:rename', id, name),
    remove: (id) => ipcRenderer.invoke('tags:remove', id),
    setColor: (id, color) => ipcRenderer.invoke('tags:setColor', id, color),
    pageIdsFor: (tagIds) => ipcRenderer.invoke('tags:pageIdsFor', tagIds)
  },
  properties: {
    getForPage: (pageId) => ipcRenderer.invoke('properties:getForPage', pageId),
    set: (pageId, key, type, value) => ipcRenderer.invoke('properties:set', pageId, key, type, value),
    knownValues: (key) => ipcRenderer.invoke('properties:knownValues', key),
    remove: (pageId, key) => ipcRenderer.invoke('properties:remove', pageId, key)
  },
  types: {
    setTemplate: (typeId, pageId) => ipcRenderer.invoke('types:setTemplate', typeId, pageId),
    getTemplate: (typeId) => ipcRenderer.invoke('types:getTemplate', typeId),
    list: () => ipcRenderer.invoke('types:list'),
    create: (name, icon) => ipcRenderer.invoke('types:create', name, icon),
    rename: (id, name) => ipcRenderer.invoke('types:rename', id, name),
    remove: (id) => ipcRenderer.invoke('types:remove', id),
    getPropertyDefinitions: (typeId) => ipcRenderer.invoke('types:getPropertyDefinitions', typeId),
    defineProperty: (typeId, name, propertyType) =>
      ipcRenderer.invoke('types:defineProperty', typeId, name, propertyType),
    renameProperty: (definitionId, name) => ipcRenderer.invoke('types:renameProperty', definitionId, name),
    removeProperty: (definitionId) => ipcRenderer.invoke('types:removeProperty', definitionId),
    reorderProperties: (typeId, orderedIds) => ipcRenderer.invoke('types:reorderProperties', typeId, orderedIds)
  },
  links: {
    getBacklinks: (pageId) => ipcRenderer.invoke('links:getBacklinks', pageId),
    searchPages: (query, excludePageId) => ipcRenderer.invoke('links:searchPages', query, excludePageId)
  },
  habits: {
    candidates: () => ipcRenderer.invoke('habits:candidates'),
    days: (typeId, dateKey, booleanKey, from, to) =>
      ipcRenderer.invoke('habits:days', typeId, dateKey, booleanKey, from, to)
  },
  tasks: {
    inRange: (from, to) => ipcRenderer.invoke('tasks:inRange', from, to),
    overdue: (before) => ipcRenderer.invoke('tasks:overdue', before),
    undated: (limit) => ipcRenderer.invoke('tasks:undated', limit),
    forPage: (pageId) => ipcRenderer.invoke('tasks:forPage', pageId),
    datedPages: (from, to) => ipcRenderer.invoke('tasks:datedPages', from, to),
    setDone: (pageId, blockId, done) => ipcRenderer.invoke('tasks:setDone', pageId, blockId, done)
  },
  activity: {
    getRecent: (limit) => ipcRenderer.invoke('activity:getRecent', limit)
  },
  shell: {
    openPath: (target) => ipcRenderer.invoke('shell:openPath', target)
  },
  stats: {
    getStorage: () => ipcRenderer.invoke('stats:getStorage'),
    getGraphPreview: () => ipcRenderer.invoke('stats:getGraphPreview'),
    getGraph: () => ipcRenderer.invoke('stats:getGraph'),
    getDataDir: () => ipcRenderer.invoke('stats:getDataDir'),
    getBackups: () => ipcRenderer.invoke('stats:getBackups')
  },
  io: {
    exportPageMarkdown: (pageId) => ipcRenderer.invoke('io:exportPageMarkdown', pageId),
    exportPageJSON: (pageId) => ipcRenderer.invoke('io:exportPageJSON', pageId),
    exportAllMarkdown: () => ipcRenderer.invoke('io:exportAllMarkdown'),
    importMarkdown: (content, filename) => ipcRenderer.invoke('io:importMarkdown', content, filename),
    importJSON: (content) => ipcRenderer.invoke('io:importJSON', content)
  },
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSelectFolder: () => ipcRenderer.invoke('dialog:showSelectFolder')
  }
}

const fs = {
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
  writeFiles: (folder: string, files: { filename: string; content: string }[]) =>
    ipcRenderer.invoke('fs:writeFiles', folder, files)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('fs', fs)
