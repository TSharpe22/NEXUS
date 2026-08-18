import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  VALID_LINK_PROTOCOLS,
  type BlockNoteEditor as CoreBlockNoteEditor,
} from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { toggleBlock } from './toggle-block'
import { calloutBlock } from './callout-block'
import { pageMention } from './page-link'

// Register the `nexus:` scheme with BlockNote's link validator.
//
// Tiptap's Link mark sanitizes any href whose protocol isn't allowlisted,
// rewriting it to an empty string. BlockNote passes VALID_LINK_PROTOCOLS to
// that extension by reference and isAllowedUri() re-reads the array on every
// check, so pushing here — at module load, before useCreateBlockNote runs —
// is enough. Without it the formatting toolbar's "Link to page" action
// produced <a href=""> and every page link it made was dead on arrival.
if (!VALID_LINK_PROTOCOLS.includes('nexus')) {
  VALID_LINK_PROTOCOLS.push('nexus')
}

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
