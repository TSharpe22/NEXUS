import { createReactBlockSpec } from '@blocknote/react'

// Toggle block: a collapsible container with an inline header and nested children.
//
// Open state lives in block.props.open so BlockNote serializes it with the rest
// of the block JSON, but Editor.tsx resets every toggle to `open: true` after
// loading a page — the spec says the expand state is ephemeral and should not
// persist across sessions.
//
// Children are rendered by BlockNote in a sibling `.bn-block-group` element.
// We toggle visibility via CSS in globals.css using an attribute selector on
// the block container: `.bn-block-container:has(> .bn-block-content .nx-toggle[data-open="false"]) > .bn-block-group { display: none }`.

export const toggleBlock = createReactBlockSpec(
  {
    type: 'toggle',
    content: 'inline',
    propSchema: {
      open: { default: true },
    },
  },
  {
    render: ({ block, editor, contentRef }) => {
      const open = block.props.open !== false

      const toggle = () => {
        editor.updateBlock(block, {
          type: 'toggle',
          props: { open: !open },
        })
      }

      return (
        <div className="nx-toggle" data-open={open ? 'true' : 'false'}>
          <button
            type="button"
            className="nx-toggle__chevron"
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            contentEditable={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M4 3l4 3-4 3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="nx-toggle__summary" ref={contentRef} />
        </div>
      )
    },
  },
)
