/// <reference types="vite/client" />

import type { NexusAPI, NexusLifecycle } from '../shared/types'

declare global {
  interface Window {
    api: NexusAPI
    fs: {
      readFile(path: string): Promise<string>
      writeFile(path: string, content: string): Promise<void>
      writeFiles(folder: string, files: { filename: string; content: string }[]): Promise<void>
    }
    lifecycle: NexusLifecycle
  }
}
