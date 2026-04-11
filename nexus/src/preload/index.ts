import { contextBridge, ipcRenderer } from 'electron'
import type { NexusAPI } from '../shared/types'

const api: NexusAPI = {
  pages: {
    create: () => ipcRenderer.invoke('pages:create'),
    getAll: () => ipcRenderer.invoke('pages:getAll'),
    getById: (id) => ipcRenderer.invoke('pages:getById', id),
    update: (id, data) => ipcRenderer.invoke('pages:update', id, data),
    softDelete: (id) => ipcRenderer.invoke('pages:softDelete', id),
    restore: (id) => ipcRenderer.invoke('pages:restore', id),
    hardDelete: (id) => ipcRenderer.invoke('pages:hardDelete', id),
    getDeleted: () => ipcRenderer.invoke('pages:getDeleted'),
    duplicate: (id) => ipcRenderer.invoke('pages:duplicate', id),
  },
  blocks: {
    getByPageId: (pageId) => ipcRenderer.invoke('blocks:getByPageId', pageId),
    save: (pageId, blocks) => ipcRenderer.invoke('blocks:save', pageId, blocks),
  },
  links: {
    getBacklinks: (pageId) => ipcRenderer.invoke('links:getBacklinks', pageId),
    syncLinks: (pageId, linkTargets) => ipcRenderer.invoke('links:syncLinks', pageId, linkTargets),
  },
  io: {
    exportPageMarkdown: (pageId) => ipcRenderer.invoke('io:exportPageMarkdown', pageId),
    exportPageJSON: (pageId) => ipcRenderer.invoke('io:exportPageJSON', pageId),
    exportAllMarkdown: () => ipcRenderer.invoke('io:exportAllMarkdown'),
    exportAllJSON: () => ipcRenderer.invoke('io:exportAllJSON'),
    importMarkdown: (content, filename) => ipcRenderer.invoke('io:importMarkdown', content, filename),
    importJSON: (content) => ipcRenderer.invoke('io:importJSON', content),
    importPlainText: (content, filename) => ipcRenderer.invoke('io:importPlainText', content, filename),
  },
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSelectFolder: () => ipcRenderer.invoke('dialog:showSelectFolder'),
  },
}

// Additional fs helpers exposed separately
const fs = {
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
  writeFiles: (folder: string, files: { filename: string; content: string }[]) =>
    ipcRenderer.invoke('fs:writeFiles', folder, files),
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('fs', fs)
