import { create } from 'zustand'

export type View = 'atlas' | 'vault' | 'command' | 'flow' | 'settings'

interface AppState {
  activeView: View
  setActiveView: (view: View) => void
  activePageId: string | null
  setActivePageId: (id: string | null) => void
  commandTypeId: string | null
  setCommandTypeId: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeView: 'atlas',
  setActiveView: (view) => set({ activeView: view }),
  activePageId: null,
  setActivePageId: (id) => set({ activePageId: id }),
  commandTypeId: null,
  setCommandTypeId: (id) => set({ commandTypeId: id })
}))
