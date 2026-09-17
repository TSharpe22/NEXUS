import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  getBezierPath,
  useStore,
  type EdgeProps,
  type NodeProps
} from '@xyflow/react'
import { CANVAS_COLORS, MIN_CARD, type CanvasColor } from '@shared/canvas'
import { documentPreview } from '@shared/document'
import { attachmentUrl } from '@shared/attachments'
import { useAppStore } from '../store/app-store'
import { Editor } from '../editor/Editor'
import { relativeTime } from '../hooks/use-relative-time'
import { renderMarkdown } from './markdown'
import { useCanvas } from './context'
import type { CardNode, LinkEdge } from './flow'

/** How many things are selected — a toolbar belongs to a card only when it is alone. */
const selectedCount = (s: { nodes: { selected?: boolean }[]; edges: { selected?: boolean }[] }) =>
  s.nodes.filter((n) => n.selected).length + s.edges.filter((e) => e.selected).length

const SIDES: { id: string; position: Position }[] = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left }
]

/**
 * One handle per side, each able to start or end an arrow — the board runs in
 * loose connection mode, so there is no "output" side. The side a handle is on
 * is its id, which is what JSON Canvas stores as `fromSide` / `toSide`.
 */
function Sides() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle key={side.id} id={side.id} type="source" position={side.position} className="nx-canvas-handle" />
      ))}
    </>
  )
}

function Swatches({ id, color }: { id: string; color?: CanvasColor }) {
  const { setColor } = useCanvas()
  return (
    <span className="nx-canvas-swatches">
      <button
        className={`nx-canvas-swatch nx-canvas-swatch--none ${!color ? 'is-current' : ''}`}
        title="No colour"
        aria-label="No colour"
        onClick={() => setColor([id], undefined)}
      />
      {CANVAS_COLORS.map((c) => (
        <button
          key={c}
          className={`nx-canvas-swatch ${color === c ? 'is-current' : ''}`}
          style={{ '--nx-swatch': `var(--nx-${c})` } as React.CSSProperties}
          title={c}
          aria-label={`Colour ${c}`}
          onClick={() => setColor([id], c)}
        />
      ))}
    </span>
  )
}

/** The frame every card shares: sides, resize handles, and a toolbar when it is the only thing selected. */
function CardFrame({
  id,
  selected,
  color,
  kind,
  editing,
  tools,
  children,
  onDoubleClick,
  keepAspectRatio
}: {
  id: string
  selected: boolean
  color?: CanvasColor
  kind: string
  editing?: boolean
  tools?: ReactNode
  children: ReactNode
  onDoubleClick?: (e: React.MouseEvent) => void
  keepAspectRatio?: boolean
}) {
  const { remove } = useCanvas()
  const alone = useStore(selectedCount) === 1
  return (
    <>
      <NodeResizer
        isVisible={selected && !editing}
        keepAspectRatio={keepAspectRatio}
        minWidth={MIN_CARD.width}
        minHeight={MIN_CARD.height}
        lineClassName="nx-canvas-resize-line"
        handleClassName="nx-canvas-resize-handle"
      />
      <NodeToolbar isVisible={selected && alone} position={Position.Top} className="nx-canvas-toolbar">
        <Swatches id={id} color={color} />
        {tools}
        <button className="nx-canvas-toolbar__danger" onClick={() => remove([id])} title="Delete (Backspace)">
          delete
        </button>
      </NodeToolbar>
      <div
        className={[
          'nx-canvas-card',
          `nx-canvas-card--${kind}`,
          color ? 'nx-canvas-card--coloured' : '',
          selected ? 'is-selected' : '',
          editing ? 'is-editing' : ''
        ].join(' ')}
        style={color ? ({ '--nx-card-tone': `var(--nx-${color})` } as React.CSSProperties) : undefined}
        onDoubleClick={onDoubleClick}
      >
        {children}
      </div>
      <Sides />
    </>
  )
}

// ------------------------------------------------------------------
// Text
// ------------------------------------------------------------------

export function TextCard({ id, data, selected }: NodeProps<CardNode>) {
  const { editingId, setEditingId, updateCard, makePage, openTitle } = useCanvas()
  const editing = editingId === id
  const text = data.text ?? ''
  const [draft, setDraft] = useState(text)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // An undo, or anything else that rewrites the card, lands in the draft —
  // but never under the cursor of the person typing in it.
  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  useEffect(() => {
    if (!editing) return
    const area = areaRef.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [editing])

  const html = useMemo(() => renderMarkdown(text), [text])

  const commit = () => {
    if (draft !== text) updateCard(id, { text: draft })
    if (editingId === id) setEditingId(null)
  }

  return (
    <CardFrame
      id={id}
      kind="text"
      selected={selected}
      color={data.color}
      editing={editing}
      onDoubleClick={() => setEditingId(id)}
      tools={
        <>
          <button onClick={() => setEditingId(id)}>edit</button>
          <button onClick={() => void makePage(id)} title="Make this card a page of its own">
            make page
          </button>
        </>
      }
    >
      {editing ? (
        <textarea
          ref={areaRef}
          className="nx-canvas-card__textarea nodrag nowheel nokey"
          value={draft}
          placeholder="Markdown. [[Page title]] links a page."
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
      ) : text.trim() ? (
        <div
          className="nx-md nx-canvas-card__md"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const link = (e.target as Element).closest('.nx-md__wikilink') as HTMLElement | null
            if (!link?.dataset.title) return
            e.preventDefault()
            e.stopPropagation()
            void openTitle(link.dataset.title)
          }}
        />
      ) : (
        <div className="nx-canvas-card__placeholder nx-type-data">double-click to write</div>
      )}
    </CardFrame>
  )
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export function PageCard({ id, data, selected }: NodeProps<CardNode>) {
  const { editingId, setEditingId, openPage } = useCanvas()
  const pageId = data.pageId ?? ''
  const page = useAppStore((s) => s.pages.find((p) => p.id === pageId))
  const trashed = useAppStore((s) => s.trashed.some((p) => p.id === pageId))
  const content = useAppStore((s) => s.pageContent[pageId])
  const unlocked = useAppStore((s) => s.unlockedPageIds.includes(pageId))
  const typeName = useAppStore((s) => (page ? s.types.find((t) => t.id === page.type_id)?.name : undefined))
  const loadPageContent = useAppStore((s) => s.loadPageContent)

  const sealed = !!page?.is_locked && !unlocked
  const editing = editingId === id && !!page && !sealed && content !== undefined

  useEffect(() => {
    if (page && !sealed) void loadPageContent(pageId)
  }, [page, sealed, pageId, loadPageContent])

  const preview = useMemo(() => (content === undefined ? '' : documentPreview(content, 900)), [content])

  if (!page) {
    return (
      <CardFrame id={id} kind="page" selected={selected} color={data.color}>
        <div className="nx-canvas-card__missing">
          <div className="nx-canvas-card__title">{trashed ? 'A page in the trash' : 'A page that no longer exists'}</div>
          <div className="nx-type-data">
            {trashed ? 'restore it from Notes to see it here' : 'this card can be deleted'}
          </div>
        </div>
      </CardFrame>
    )
  }

  return (
    <CardFrame
      id={id}
      kind="page"
      selected={selected}
      color={data.color}
      editing={editing}
      onDoubleClick={() => {
        if (!sealed) setEditingId(id)
      }}
      tools={
        <>
          {!sealed && <button onClick={() => setEditingId(editing ? null : id)}>{editing ? 'done' : 'edit'}</button>}
          <button onClick={() => openPage(pageId)}>open in notes</button>
        </>
      }
    >
      <div className="nx-canvas-card__head">
        <span className="nx-canvas-card__title">{page.title || 'Untitled'}</span>
        <button
          className="nx-canvas-card__open nodrag"
          title="Open in Notes"
          aria-label="Open in Notes"
          onClick={(e) => {
            e.stopPropagation()
            openPage(pageId)
          }}
        >
          ↗
        </button>
      </div>
      <div className="nx-canvas-card__meta nx-type-data">
        {typeName ?? 'Note'} · {relativeTime(page.updated_at)}
        {sealed && ' · locked'}
      </div>
      {editing ? (
        <div
          className="nx-canvas-card__editor nodrag nowheel nopan nokey"
          onKeyDown={(e) => {
            // Esc leaves the editor, unless it is closing one of the editor's
            // own menus — the slash menu and the link menu both use it.
            if (e.key !== 'Escape' || document.querySelector('.bn-suggestion-menu, [role="listbox"]')) return
            e.stopPropagation()
            setEditingId(null)
          }}
        >
          <Editor key={pageId} page={{ ...page, content: content! }} compact />
        </div>
      ) : (
        <div className="nx-canvas-card__preview">
          {sealed ? (
            <span className="nx-type-data">This page has a password. Open it in Notes to unlock it.</span>
          ) : content === undefined ? (
            <span className="nx-type-data">loading…</span>
          ) : preview ? (
            preview
          ) : (
            <span className="nx-type-data">empty · double-click to write</span>
          )}
        </div>
      )}
    </CardFrame>
  )
}

// ------------------------------------------------------------------
// Group
// ------------------------------------------------------------------

export function GroupCard({ id, data, selected }: NodeProps<CardNode>) {
  const { editingId, setEditingId, updateCard, createTextAt } = useCanvas()
  const editing = editingId === id
  const [draft, setDraft] = useState(data.label ?? '')

  useEffect(() => {
    if (!editing) setDraft(data.label ?? '')
  }, [data.label, editing])

  const commit = () => {
    const label = draft.trim()
    if (label !== (data.label ?? '')) updateCard(id, { label: label || undefined })
    if (editingId === id) setEditingId(null)
  }

  return (
    <CardFrame
      id={id}
      kind="group"
      selected={selected}
      color={data.color}
      tools={<button onClick={() => setEditingId(id)}>rename</button>}
      onDoubleClick={(e) => {
        // The label renames; the empty body of a group is still canvas, and
        // double-clicking canvas writes a card.
        if ((e.target as Element).closest('.nx-canvas-group__label')) setEditingId(id)
        else createTextAt(e.clientX, e.clientY)
      }}
    >
      <div className="nx-canvas-group__label">
        {editing ? (
          <input
            className="nx-canvas-group__input nodrag nokey"
            autoFocus
            value={draft}
            placeholder="Group name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
          />
        ) : (
          data.label || <span className="nx-canvas-group__unnamed">group</span>
        )}
      </div>
    </CardFrame>
  )
}

// ------------------------------------------------------------------
// Image
// ------------------------------------------------------------------

export function ImageCard({ id, data, selected }: NodeProps<CardNode>) {
  const { fitImage } = useCanvas()
  const [failed, setFailed] = useState(false)
  const natural = useRef<{ w: number; h: number } | null>(null)
  const src = data.file ? attachmentUrl(data.file) : ''

  return (
    <CardFrame
      id={id}
      kind="image"
      selected={selected}
      color={data.color}
      keepAspectRatio
      tools={
        !failed && (
          <button
            onClick={() => natural.current && fitImage(id, natural.current.w, natural.current.h)}
            title="Undo any stretching: back to the picture's own proportions"
          >
            fit to image
          </button>
        )
      }
    >
      {failed || !src ? (
        <div className="nx-canvas-card__missing">
          <div className="nx-canvas-card__title">A missing picture</div>
          <div className="nx-type-data">its file is no longer in the attachment store</div>
        </div>
      ) : (
        <img
          className="nx-canvas-card__image"
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => {
            natural.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }
          }}
          onError={() => setFailed(true)}
        />
      )}
    </CardFrame>
  )
}

// ------------------------------------------------------------------
// A card from a later build
// ------------------------------------------------------------------

export function UnknownCard({ id, data, selected }: NodeProps<CardNode>) {
  return (
    <CardFrame id={id} kind="unknown" selected={selected}>
      <div className="nx-canvas-card__missing">
        <div className="nx-canvas-card__title">A “{String(data.raw.type)}” card</div>
        <div className="nx-type-data">made by a newer Nexus · kept as it is</div>
      </div>
    </CardFrame>
  )
}

export const CARD_TYPES = { text: TextCard, page: PageCard, group: GroupCard, image: ImageCard, unknown: UnknownCard }

// ------------------------------------------------------------------
// Arrows
// ------------------------------------------------------------------

export function LinkEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd
}: EdgeProps<LinkEdge>) {
  const { editingId, setEditingId, updateLink, remove } = useCanvas()
  const editing = editingId === `edge:${id}`
  const label = data?.label ?? ''
  const [draft, setDraft] = useState(label)
  const alone = useStore(selectedCount) === 1

  useEffect(() => {
    if (!editing) setDraft(label)
  }, [label, editing])

  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const tone = data?.color ? `var(--nx-${data.color})` : undefined

  const commit = () => {
    const next = draft.trim()
    if (next !== label) updateLink(id, { label: next || undefined })
    if (editingId === `edge:${id}`) setEditingId(null)
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        className={`nx-canvas-link ${selected ? 'is-selected' : ''}`}
        style={tone ? { stroke: tone } : undefined}
      />
      <EdgeLabelRenderer>
        <div
          className="nx-canvas-link__label-wrap nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {editing ? (
            <input
              className="nx-canvas-link__input nokey"
              autoFocus
              value={draft}
              placeholder="label"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              }}
            />
          ) : (
            label && (
              <div className="nx-canvas-link__label" onDoubleClick={() => setEditingId(`edge:${id}`)}>
                {label}
              </div>
            )
          )}
          {selected && alone && !editing && (
            <div className="nx-canvas-toolbar nx-canvas-toolbar--edge">
              <span className="nx-canvas-swatches">
                <button
                  className={`nx-canvas-swatch nx-canvas-swatch--none ${!data?.color ? 'is-current' : ''}`}
                  aria-label="No colour"
                  onClick={() => updateLink(id, { color: undefined })}
                />
                {CANVAS_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`nx-canvas-swatch ${data?.color === c ? 'is-current' : ''}`}
                    style={{ '--nx-swatch': `var(--nx-${c})` } as React.CSSProperties}
                    aria-label={`Colour ${c}`}
                    onClick={() => updateLink(id, { color: c })}
                  />
                ))}
              </span>
              <button onClick={() => setEditingId(`edge:${id}`)}>{label ? 'relabel' : 'label'}</button>
              <button onClick={() => updateLink(id, { toEnd: data?.toEnd === 'none' ? undefined : 'none' })}>
                {data?.toEnd === 'none' ? 'arrow' : 'line'}
              </button>
              <button className="nx-canvas-toolbar__danger" onClick={() => remove([id])}>
                delete
              </button>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const LINK_TYPES = { link: LinkEdgeView }
