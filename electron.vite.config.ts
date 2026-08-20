import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

/**
 * Stamped into the build so a running Nexus can say which one it is.
 *
 * Every build carries the same `version`, so that alone cannot tell you
 * whether an install took. The commit can — it is the only thing that changes
 * between two builds of the same version.
 */
function buildStamp(): string {
  const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    // A build from a dirty tree is not the commit it names.
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (dirty) commit += '+local'
  } catch {
    // Built outside a checkout — a tarball, or a packaged source drop.
  }
  return JSON.stringify({ version, commit, builtAt: new Date().toISOString() })
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    define: {
      __NEXUS_BUILD__: buildStamp()
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    }
  }
})
