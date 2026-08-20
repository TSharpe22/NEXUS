/// <reference types="vite/client" />

import type { NexusAPI } from '../shared/types'

declare global {
  /**
   * Build identity, replaced at compile time by `electron.vite.config.ts`.
   * `commit` is the only field that distinguishes two builds of one version,
   * and carries a `+local` suffix when the tree was dirty.
   */
  const __NEXUS_BUILD__: {
    version: string
    commit: string
    builtAt: string
  }

  interface Window {
    api: NexusAPI
    fs: {
      readFile(path: string): Promise<string>
      writeFile(path: string, content: string): Promise<void>
      writeFiles(folder: string, files: { filename: string; content: string }[]): Promise<void>
    }
  }
}
