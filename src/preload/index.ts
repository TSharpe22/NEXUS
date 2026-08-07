import { contextBridge, ipcRenderer } from 'electron'
import type { NexusAPI } from '../shared/types'

const api: NexusAPI = {
  pages: {
    create: (typeId) => ipcRenderer.invoke('pages:create', typeId),
    getAll: () => ipcRenderer.invoke('pages:getAll'),
    getAllSummary: (typeId) => ipcRenderer.invoke('pages:getAllSummary', typeId),
    getById: (id) => ipcRenderer.invoke('pages:getById', id),
    update: (id, data) => ipcRenderer.invoke('pages:update', id, data),
    softDelete: (id) => ipcRenderer.invoke('pages:softDelete', id),
    restore: (id) => ipcRenderer.invoke('pages:restore', id),
    hardDelete: (id) => ipcRenderer.invoke('pages:hardDelete', id),
    getDeleted: () => ipcRenderer.invoke('pages:getDeleted'),
    duplicate: (id) => ipcRenderer.invoke('pages:duplicate', id)
  },
  properties: {
    getForPage: (pageId) => ipcRenderer.invoke('properties:getForPage', pageId),
    set: (pageId, key, type, value) => ipcRenderer.invoke('properties:set', pageId, key, type, value),
    remove: (pageId, key) => ipcRenderer.invoke('properties:remove', pageId, key)
  },
  types: {
    list: () => ipcRenderer.invoke('types:list'),
    create: (name, icon) => ipcRenderer.invoke('types:create', name, icon),
    getPropertyDefinitions: (typeId) => ipcRenderer.invoke('types:getPropertyDefinitions', typeId),
    defineProperty: (typeId, name, propertyType) =>
      ipcRenderer.invoke('types:defineProperty', typeId, name, propertyType)
  },
  links: {
    getBacklinks: (pageId) => ipcRenderer.invoke('links:getBacklinks', pageId),
    syncLinks: (pageId, linkTargets) => ipcRenderer.invoke('links:syncLinks', pageId, linkTargets),
    searchPages: (query) => ipcRenderer.invoke('links:searchPages', query)
  },
  activity: {
    getRecent: (limit) => ipcRenderer.invoke('activity:getRecent', limit)
  },
  stats: {
    getStorage: () => ipcRenderer.invoke('stats:getStorage'),
    getGraphPreview: () => ipcRenderer.invoke('stats:getGraphPreview')
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
