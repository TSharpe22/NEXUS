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
    //
    // The one exclusion is this file's own shadow: electron-vite compiles this
    // TypeScript config to `electron.vite.config.<timestamp>.mjs` beside
    // itself, builds through that, and deletes it afterwards — so it exists
    // exactly while this line is asking whether the tree is clean. It is in
    // `.gitignore` now, and filtered here as well, because a marker that is
    // always on is a marker that says nothing: every build ever made called
    // itself `+local`, including every clean one.
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .filter((line) => line.trim() && !/electron\.vite\.config\.\d+\.mjs$/.test(line))
      .join('\n')
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
