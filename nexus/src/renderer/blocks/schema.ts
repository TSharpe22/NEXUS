import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  type BlockNoteEditor as CoreBlockNoteEditor,
} from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { toggleBlock } from './toggle-block'
import { calloutBlock } from './callout-block'
import { pageMention } from './page-link'

// Extended schema:
// - default blocks (paragraph, headings, lists, table, code, quote, etc.)
// - our two custom blocks (toggle, callout)
// - column / columnList from @blocknote/xl-multi-column (GPL-3.0; allowed
//   because Nexus is a personal local-first tool, never distributed
//   commercially — see plan notes).
// - pageMention inline content (Phase 03: bidirectional links)
export const nexusSchema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      toggle: toggleBlock,
      callout: calloutBlock,
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      pageMention,
    },
  }),
)

export type NexusEditor = CoreBlockNoteEditor<
  typeof nexusSchema.blockSchema,
  typeof nexusSchema.inlineContentSchema,
  typeof nexusSchema.styleSchema
>
