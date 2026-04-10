const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export function shortcutLabel(key: string): string {
  return isMacPlatform ? `⌘${key}` : `Ctrl+${key}`
}

export function isMac(): boolean {
  return isMacPlatform
}
