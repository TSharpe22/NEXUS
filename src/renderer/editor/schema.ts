import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core'
import { toggleBlock, calloutBlock } from './custom-blocks'
import { pageMention } from './page-mention'

export const nexusSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    toggle: toggleBlock,
    callout: calloutBlock
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageMention
  }
})

export type NexusEditor = typeof nexusSchema.BlockNoteEditor
