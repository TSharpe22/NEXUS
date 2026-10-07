import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core'
import { toggleBlock, calloutBlock } from './custom-blocks'
import { pageMention } from './page-mention'

/**
 * BlockNote 0.55 ships a toggle of its own (`toggleListItem`, plus toggleable
 * headings). Nexus already has one, `toggle`, and every saved toggle is that
 * type, so the built-in one is left out: two toggles in the "/" menu would be
 * two incompatible kinds of the same thing in one vault, and moving to the
 * built-in one means rewriting saved documents, which an upgrade should not do.
 */
const { toggleListItem: _builtInToggle, ...builtInBlocks } = defaultBlockSpecs

export const nexusSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...builtInBlocks,
    // Since BlockNote 0.39 a React block spec is a factory, called for the spec.
    toggle: toggleBlock(),
    callout: calloutBlock()
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageMention
  }
})

export type NexusEditor = typeof nexusSchema.BlockNoteEditor
