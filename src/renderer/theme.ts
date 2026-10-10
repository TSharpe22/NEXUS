import type { Theme } from '@shared/types'

/**
 * The look: `default` (tokens.css) or `miami` (theme-miami.css). Stored in
 * the vault as a preference; mirrored in localStorage only so the first
 * paint is already right.
 */
const KEY = 'nx-theme'

export function cachedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'miami' ? 'miami' : 'default'
  } catch {
    return 'default'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'default') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Storage refused: the vault still has it, and the next load applies it.
  }
}
