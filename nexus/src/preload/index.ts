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
}

contextBridge.exposeInMainWorld('api', api)
