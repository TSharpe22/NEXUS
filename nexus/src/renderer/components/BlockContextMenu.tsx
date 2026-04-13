import React from 'react'
import { Menu, type MenuSection, type MenuItem } from './Menu'
import { COLOR_KEYS, COLORS } from '../blocks/callout-colors'
import { PageIcon } from '../blocks/icons'
import type { NexusEditor } from '../blocks/schema'
import { useAppStore } from '../stores/app-store'

// Right-click menu for blocks inside the editor. Two primary sections:
//   1. Block actions (delete, duplicate, copy, cut, move up/down)
//   2. Transform To (paragraph, heading 1/2/3, lists, code, callout, toggle)
// A third "Color" submenu is added for callout blocks.
//
// All actions are delegated to the BlockNote editor. The block reference is a
// `BlockNoteBlock` returned by `editor.getBlock(id)`.

type AnyBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown }

interface Props {
  editor: NexusEditor
  block: AnyBlock
  x: number
  y: number
  onClose: () => void
  selectedBlockIds?: string[]
}

type TransformEntry = {
  id: string
  label: string
  icon: React.ReactNode
  type: string
  extraProps?: Record<string, unknown>
}

const TRANSFORMS: TransformEntry[] = [
  { id: 'paragraph', label: 'Paragraph', icon: '¶', type: 'paragraph' },
  { id: 'h1', label: 'Heading 1', icon: 'H1', type: 'heading', extraProps: { level: 1 } },
  { id: 'h2', label: 'Heading 2', icon: 'H2', type: 'heading', extraProps: { level: 2 } },
  { id: 'h3', label: 'Heading 3', icon: 'H3', type: 'heading', extraProps: { level: 3 } },
  { id: 'bullet', label: 'Bullet List', icon: '•', type: 'bulletListItem' },
  { id: 'numbered', label: 'Numbered List', icon: '1.', type: 'numberedListItem' },
  { id: 'check', label: 'Check List', icon: '☐', type: 'checkListItem' },
  { id: 'code', label: 'Code Block', icon: '</>', type: 'codeBlock' },
  { id: 'callout', label: 'Callout', icon: <PageIcon iconKey="bulb" size={13} />, type: 'callout' },
  { id: 'toggle', label: 'Toggle', icon: '▸', type: 'toggle' },
]

function isTransformActive(block: AnyBlock, entry: TransformEntry): boolean {
  if (block.type !== entry.type) return false
  if (entry.type === 'heading') {
    const lvl = (block.props as { level?: number })?.level
    return lvl === (entry.extraProps as { level: number }).level
  }
  return true
}

// Best-effort plaintext extraction from inline content for copy / cut.
function blockToPlainText(block: AnyBlock): string {
  const content = (block as { content?: unknown }).content
  if (!content) return ''
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c) return String((c as { text: string }).text)
        return ''
      })
      .join('')
  }
  return ''
}

export function BlockContextMenu({ editor, block, x, y, onClose, selectedBlockIds = [] }: Props) {
  const currentPageId = useAppStore((s) => s.currentPage?.id)
  const isMultiSelect = selectedBlockIds.length > 1
  const isCallout = !isMultiSelect && block.type === 'callout'

  const targetIds = isMultiSelect ? selectedBlockIds : [block.id]

  const actions: MenuItem[] = [
    {
      id: 'delete',
      label: isMultiSelect ? `Delete ${targetIds.length} blocks` : 'Delete',
      icon: iconTrash,
      shortcut: isMultiSelect ? undefined : '⌘⇧⌫',
      danger: true,
      onSelect: () => editor.removeBlocks(targetIds),
    },
    {
      id: 'duplicate',
      label: isMultiSelect ? `Duplicate ${targetIds.length} blocks` : 'Duplicate',
      icon: iconCopy,
      shortcut: '⌘D',
      onSelect: () => {
        const lastId = targetIds[targetIds.length - 1]
        const clones = targetIds
          .map((bid) => {
            const b = editor.getBlock(bid) as AnyBlock | undefined
            if (!b) return null
            return { type: b.type, props: { ...b.props }, content: b.content }
          })
          .filter(Boolean) as Parameters<typeof editor.insertBlocks>[0]
        if (clones.length > 0) editor.insertBlocks(clones as never, lastId, 'after')
      },
    },
    {
      id: 'copy',
      label: isMultiSelect ? `Copy ${targetIds.length} blocks` : 'Copy',
      icon: iconClipboard,
      onSelect: () => {
        const texts = targetIds.map((bid) => {
          const b = editor.getBlock(bid) as AnyBlock | undefined
          return b ? blockToPlainText(b) : ''
        })
        void navigator.clipboard.writeText(texts.join('\n'))
      },
    },
    {
      id: 'cut',
      label: isMultiSelect ? `Cut ${targetIds.length} blocks` : 'Cut',
      icon: iconScissors,
      onSelect: () => {
        const texts = targetIds.map((bid) => {
          const b = editor.getBlock(bid) as AnyBlock | undefined
          return b ? blockToPlainText(b) : ''
        })
        void navigator.clipboard.writeText(texts.join('\n'))
        editor.removeBlocks(targetIds)
      },
    },
    {
      id: 'copy-link',
      label: 'Copy link to page',
      icon: iconLink,
      onSelect: () => {
        if (currentPageId) {
          void navigator.clipboard.writeText(`nexus://${currentPageId}`)
        }
      },
    },
    {
      id: 'move-up',
      label: 'Move Up',
      icon: iconArrowUp,
      onSelect: () => {
        editor.setTextCursorPosition(block.id, 'start')
        editor.moveBlocksUp()
      },
    },
    {
      id: 'move-down',
      label: 'Move Down',
      icon: iconArrowDown,
      onSelect: () => {
        editor.setTextCursorPosition(block.id, 'start')
        editor.moveBlocksDown()
      },
    },
  ]

  const transforms: MenuItem[] = TRANSFORMS.map((entry) => ({
    id: `transform-${entry.id}`,
    label: entry.label,
    icon: typeof entry.icon === 'string'
      ? <span className="nx-menu__icon-text">{entry.icon}</span>
      : entry.icon,
    isActive: !isMultiSelect && isTransformActive(block, entry),
    onSelect: () => {
      for (const bid of targetIds) {
        editor.updateBlock(bid, {
          type: entry.type,
          props: entry.extraProps ? { ...entry.extraProps } : undefined,
        } as Parameters<typeof editor.updateBlock>[1])
      }
    },
  }))

  const sections: MenuSection[] = [
    { id: 'actions', items: actions },
    { id: 'transform', heading: 'Transform to', items: transforms },
  ]

  if (isCallout) {
    const currentColor = (block.props as { color?: string }).color ?? 'blue'
    const colorItems: MenuItem[] = COLOR_KEYS.map((key) => ({
      id: `color-${key}`,
      label: COLORS[key].label,
      isActive: currentColor === key,
      icon: (
        <span
          className="nx-menu__swatch"
          style={{ background: COLORS[key].bg, borderColor: COLORS[key].border }}
        />
      ),
      onSelect: () => {
        editor.updateBlock(block.id, {
          type: 'callout',
          props: { ...block.props, color: key },
        } as Parameters<typeof editor.updateBlock>[1])
      },
    }))
    sections.push({
      id: 'color',
      heading: 'Color',
      items: [
        {
          id: 'color-picker',
          label: 'Color',
          icon: (
            <span
              className="nx-menu__swatch"
              style={{
                background: COLORS[currentColor as keyof typeof COLORS]?.bg ?? COLORS.blue.bg,
                borderColor:
                  COLORS[currentColor as keyof typeof COLORS]?.border ?? COLORS.blue.border,
              }}
            />
          ),
          submenu: [{ id: 'color-list', items: colorItems }],
        },
      ],
    })
  }

  return <Menu x={x} y={y} sections={sections} onClose={onClose} minWidth={230} />
}

// Inline SVG icons kept small and inside this file so the menu stays standalone.
const iconStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const iconTrash = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
)
const iconCopy = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)
const iconClipboard = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
)
const iconScissors = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
)
const iconArrowUp = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
)
const iconArrowDown = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
)
const iconLink = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...iconStroke}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </svg>
)
