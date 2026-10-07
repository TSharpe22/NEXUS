import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import type { NexusEditor } from './schema'

/**
 * BlockNote's default slash menu only knows about the block types it ships
 * with — a custom block spec is renderable but has no way to be *inserted*
 * until it's given a menu item here. Toggle and callout were in the schema
 * and unreachable from the UI.
 *
 * Groups are ordered the way the menu renders them, with the Nexus blocks
 * kept in the same "Basic blocks" group as their built-in neighbours rather
 * than exiled to a section of their own.
 */
export function getSlashMenuItems(editor: NexusEditor): DefaultReactSuggestionItem[] {
  // Toggleable headings are BlockNote's own toggle under another name; see
  // schema.ts for why Nexus keeps only its `toggle`.
  const defaults = getDefaultReactSlashMenuItems(editor).filter(
    (item) => !('key' in item && typeof item.key === 'string' && item.key.startsWith('toggle_'))
  )

  const toggle: DefaultReactSuggestionItem = {
    title: 'Toggle',
    subtext: 'Collapsible section',
    aliases: ['toggle', 'collapse', 'details', 'fold'],
    group: 'Basic blocks',
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'toggle' } as never)
  }

  const callout: DefaultReactSuggestionItem = {
    title: 'Callout',
    subtext: 'Highlighted note',
    aliases: ['callout', 'note', 'aside', 'info', 'warning'],
    group: 'Basic blocks',
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout', props: { color: 'amber' } } as never)
  }

  // Slot them in directly after the last Basic-blocks default so the group
  // stays contiguous; BlockNote renders items in array order within a group.
  const lastBasic = defaults.map((item) => item.group).lastIndexOf('Basic blocks')
  if (lastBasic === -1) return [...defaults, toggle, callout]

  return [...defaults.slice(0, lastBasic + 1), toggle, callout, ...defaults.slice(lastBasic + 1)]
}
