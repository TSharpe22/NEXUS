import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { insertOrUpdateBlock } from '@blocknote/core'
import type { NexusEditor } from './schema'

// Build the slash menu items list:
// 1. Start from BlockNote's default items.
// 2. Drop file/image/video/audio (Phase 02 is text-only; avoids upload flows
//    and external-url prompts that haven't been designed yet).
// 3. Drop `emoji` — the spec doesn't call for it and we already have emoji
//    picker in the callout block.
// 4. Append our custom blocks (Toggle, Callout).
// Columns are drag-only (drag a block next to another block).

const DROP_KEYS = new Set([
  'file',
  'image',
  'video',
  'audio',
  'emoji',
])

export type SlashItem = DefaultReactSuggestionItem

// insertOrUpdateBlock is generic over the editor's schema; the structurally-
// identical-but-nominally-distinct schema types from NexusEditor trip TS up,
// so we double-cast through `unknown` at the call boundary.
type AnyEditor = Parameters<typeof insertOrUpdateBlock>[0]
type AnyPartialBlock = Parameters<typeof insertOrUpdateBlock>[1]

export function getNexusSlashMenuItems(editor: NexusEditor): SlashItem[] {
  const anyEditor = editor as unknown as AnyEditor

  const defaults = (
    getDefaultReactSlashMenuItems(
      editor as unknown as Parameters<typeof getDefaultReactSlashMenuItems>[0],
    ) as DefaultReactSuggestionItem[]
  ).filter((item) => {
    // DefaultReactSuggestionItem omits `key` from the type, but the runtime
    // objects still carry an internal identifier we can use to drop entries.
    const key = (item as unknown as { key?: string }).key ?? ''
    return !DROP_KEYS.has(key)
  })

  const items: SlashItem[] = [...defaults]

  items.push({
    title: 'Toggle',
    subtext: 'Collapsible container',
    aliases: ['toggle', 'collapsible', 'expand', 'fold'],
    group: 'Advanced',
    onItemClick: () => {
      insertOrUpdateBlock(anyEditor, {
        type: 'toggle',
        props: { open: true },
      } as unknown as AnyPartialBlock)
    },
  })

  items.push({
    title: 'Callout',
    subtext: 'Highlighted info box',
    aliases: ['callout', 'note', 'info', 'warning', 'tip'],
    group: 'Advanced',
    onItemClick: () => {
      insertOrUpdateBlock(anyEditor, {
        type: 'callout',
        props: { icon: 'bulb', color: 'blue' },
      } as unknown as AnyPartialBlock)
    },
  })

  return items
}
