import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockNoteEditor as CoreBlockNoteEditor,
} from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { toggleBlock } from './toggle-block'
import { calloutBlock } from './callout-block'

// Extended schema:
// - default blocks (paragraph, headings, lists, table, code, quote, etc.)
// - our two custom blocks (toggle, callout)
// - column / columnList from @blocknote/xl-multi-column (GPL-3.0; allowed
//   because Nexus is a personal local-first tool, never distributed
//   commercially — see plan notes).
export const nexusSchema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      toggle: toggleBlock,
      callout: calloutBlock,
    },
  }),
)

export type NexusEditor = CoreBlockNoteEditor<
  typeof nexusSchema.blockSchema,
  typeof nexusSchema.inlineContentSchema,
  typeof nexusSchema.styleSchema
>
