import { app, BrowserWindow, nativeImage } from 'electron'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { Theme } from '@shared/types'

/**
 * The app icon follows the theme: the original mark on the default look, the
 * neon one on Miami (build/theme-icons/). Linux only.
 *
 * Three places show it, and each needs its own nudge:
 *   - the running window (and its taskbar button): BrowserWindow.setIcon;
 *   - the desktop shortcut (~/Desktop/nexus.desktop): its Icon= line;
 *   - the app menu and panel launcher: a per-user copy of the system entry in
 *     ~/.local/share/applications, which shadows /usr/share/applications.
 * The desktop entries point at copies in ~/.local/share/icons, because the
 * packaged icons live inside /opt and move with every install.
 */
const ICON_DIR = join(homedir(), '.local', 'share', 'icons')
const MENU_ENTRY = join(homedir(), '.local', 'share', 'applications', 'nexus.desktop')
const SYSTEM_ENTRY = '/usr/share/applications/nexus.desktop'

export function themeIconPath(theme: Theme): string {
  const name = `nexus-${theme}.png`
  return app.isPackaged
    ? join(process.resourcesPath, 'theme-icons', name)
    : join(app.getAppPath(), 'build', 'theme-icons', name)
}

export function applyAppIcon(theme: Theme): void {
  if (process.platform !== 'linux') return
  const source = themeIconPath(theme)
  if (!existsSync(source)) return

  const image = nativeImage.createFromPath(source)
  for (const win of BrowserWindow.getAllWindows()) win.setIcon(image)

  try {
    mkdirSync(ICON_DIR, { recursive: true })
    const installed = join(ICON_DIR, `nexus-${theme}.png`)
    copyFileSync(source, installed)
    setEntryIcon(join(app.getPath('desktop'), 'nexus.desktop'), installed, false)
    setEntryIcon(MENU_ENTRY, installed, true)
  } catch {
    // A launcher icon is cosmetic; a read-only home or a missing Desktop
    // folder leaves the old one in place rather than failing the theme change.
  }
}

/** Rewrite one entry's Icon= line, in place so file metadata (Nemo's trust flag) survives. */
function setEntryIcon(path: string, icon: string, createFromSystem: boolean): void {
  let text: string
  if (existsSync(path)) text = readFileSync(path, 'utf8')
  else if (createFromSystem && existsSync(SYSTEM_ENTRY)) {
    mkdirSync(dirname(path), { recursive: true })
    text = readFileSync(SYSTEM_ENTRY, 'utf8')
  } else return

  const next = /^Icon=.*$/m.test(text)
    ? text.replace(/^Icon=.*$/m, `Icon=${icon}`)
    : text.replace('[Desktop Entry]\n', `[Desktop Entry]\nIcon=${icon}\n`)
  if (next !== text || !existsSync(path)) writeFileSync(path, next)
}
