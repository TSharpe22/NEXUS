import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnNodeDrag,
  type Viewport
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import toast from 'react-hot-toast'
import { CARD_SIZE, MAX_IMAGE_CARD, parseCanvas, serializeCanvas, type CanvasColor, type Canvas } from '@shared/canvas'
import { attachmentName } from '@shared/attachments'
import { useAppStore } from '../store/app-store'
import { useDebounce } from '../hooks/use-debounce'
import { registerPendingWrite } from '../pending-writes'
import { CanvasContext, type CanvasActions } from './context'
import { CARD_TYPES, LINK_TYPES } from './cards'
import { docToFlow, flowToDoc, type CardData, type CardNode, type LinkData, type LinkEdge } from './flow'
import { PagePicker } from './PagePicker'

/** How many steps back undo reaches. Each is one serialised document. */
const HISTORY_LIMIT = 200
const SAVE_DEBOUNCE_MS = 600

const viewportKey = (id: string) => `nexus.canvas.viewport.${id}`

/**
 * Where the view was left, per canvas, in this browser profile only.
 *
 * Not in the document: panning is looking, not editing, and writing it into
 * `canvases.content` would bump `updated_at`, re-sort the list and rewrite the
 * mirror's file every time somebody scrolled. The same rule ROADMAP set for a
 * folded toggle — reading should not be writing.
 */
function readViewport(id: string): Viewport | undefined {
  try {
    const raw = localStorage.getItem(viewportKey(id))
    if (!raw) return undefined
    const v = JSON.parse(raw) as Viewport
    return [v.x, v.y, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) ? v : undefined
  } catch {
    return undefined
  }
}

function writeViewport(id: string, viewport: Viewport): void {
  try {
    localStorage.setItem(viewportKey(id), JSON.stringify(viewport))
  } catch {
    // Storage unavailable: the canvas simply opens fitted next time.
  }
}

const uid = () => crypto.randomUUID()

/** A node is inside a group when its whole rectangle is. */
function inside(node: CardNode, group: CardNode): boolean {
  const w = node.width ?? node.measured?.width ?? 0
  const h = node.height ?? node.measured?.height ?? 0
  const gw = group.width ?? group.measured?.width ?? 0
  const gh = group.height ?? group.measured?.height ?? 0
  return (
    node.position.x >= group.position.x &&
    node.position.y >= group.position.y &&
    node.position.x + w <= group.position.x + gw &&
    node.position.y + h <= group.position.y + gh
  )
}

function Board({ canvas }: { canvas: Canvas }) {
  const setSaveStatus = useAppStore((s) => s.setSaveStatus)
  const refreshCanvases = useAppStore((s) => s.refreshCanvases)
  const storeOpenPage = useAppStore((s) => s.openPage)
  const refreshPages = useAppStore((s) => s.refresh)
  const patchPage = useAppStore((s) => s.patchPage)
  const flow = useReactFlow<CardNode, LinkEdge>()

  const initial = useMemo(() => docToFlow(parseCanvas(canvas.content)), [canvas.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkEdge>(initial.edges)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // ----------------------------------------------------------------
  // History and saving
  // ----------------------------------------------------------------

  /**
   * Every distinct state the document has been in, as the string that would
   * be saved. Undo is moving a cursor along it, which is why a state has to
   * serialise identically however it was reached: `flowToDoc(docToFlow(s))`
   * is `s` for anything `flowToDoc` produced.
   */
  const history = useRef<string[]>([serializeCanvas(flowToDoc(initial.nodes, initial.edges))])
  const cursor = useRef(0)
  const [, bumpHistory] = useState(0)

  const save = useDebounce(async (content: string) => {
    setSaveStatus('saving')
    try {
      await window.api.canvases.update(canvas.id, { content })
      setSaveStatus('saved')
      void refreshCanvases()
    } catch (e) {
      console.error('[nexus] failed to save canvas', e)
      setSaveStatus('error')
    }
  }, SAVE_DEBOUNCE_MS)

  // Quitting waits on this. Leaving the canvas for another screen is covered
  // by the debounce hook, which flushes on unmount.
  useEffect(() => registerPendingWrite(() => save.flush()), [save])

  // The document changed when its serialisation did. Selection, hover and
  // measured sizes change nodes without changing that, and a drag or resize in
  // progress is only committed once it ends.
  useEffect(() => {
    if (nodes.some((n) => n.dragging || n.resizing)) return
    const next = serializeCanvas(flowToDoc(nodes, edges))
    if (next === history.current[cursor.current]) return
    history.current = [...history.current.slice(0, cursor.current + 1), next].slice(-HISTORY_LIMIT)
    cursor.current = history.current.length - 1
    bumpHistory((n) => n + 1)
    save.call(next)
  }, [nodes, edges, save])

  const travel = useCallback(
    (delta: -1 | 1) => {
      const to = cursor.current + delta
      if (to < 0 || to >= history.current.length) return
      cursor.current = to
      const { nodes: n, edges: e } = docToFlow(parseCanvas(history.current[to]))
      setEditingId(null)
      setNodes(n)
      setEdges(e)
      bumpHistory((x) => x + 1)
      save.call(history.current[to])
    },
    [setNodes, setEdges, save]
  )

  // ----------------------------------------------------------------
  // Making things
  // ----------------------------------------------------------------

  /** The centre of what is on screen, in canvas coordinates. */
  const viewCentre = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [flow])

  const addCard = useCallback(
    (
      type: 'text' | 'page' | 'group' | 'image',
      centre: { x: number; y: number },
      data: Partial<CardData> = {},
      size: { width: number; height: number } = CARD_SIZE[type]
    ) => {
      const id = uid()
      // A second paste or "+ text" in the same spot steps down and right
      // rather than landing exactly on the first, where it would look like
      // nothing happened.
      const position = { x: Math.round(centre.x - size.width / 2), y: Math.round(centre.y - size.height / 2) }
      const taken = flow.getNodes()
      for (let i = 0; i < 20 && taken.some((n) => Math.abs(n.position.x - position.x) < 8 && Math.abs(n.position.y - position.y) < 8); i++) {
        position.x += 32
        position.y += 32
      }
      const node: CardNode = {
        id,
        type,
        position,
        width: size.width,
        height: size.height,
        zIndex: type === 'group' ? 0 : 1,
        selected: true,
        data: { raw: {}, ...data }
      }
      setNodes((current) => {
        const deselected = current.map((n) => (n.selected ? { ...n, selected: false } : n))
        return type === 'group' ? [node, ...deselected] : [...deselected, node]
      })
      setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)))
      if (type === 'text') setEditingId(id)
      if (type === 'group') setEditingId(id)
      return id
    },
    [setNodes, setEdges, flow]
  )

  /**
   * Put pictures on the canvas: stored in the attachment store exactly as a
   * picture pasted into a page is, then placed as cards sized to their own
   * proportions. Several at once are fanned out rather than stacked.
   */
  const imageInput = useRef<HTMLInputElement>(null)
  const addImages = useCallback(
    async (files: File[], centre: { x: number; y: number }) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return
      let offset = 0
      for (const file of images) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const stored = await window.api.files.store(bytes, file.name || `pasted.${file.type.split('/')[1] ?? 'png'}`)
          const name = attachmentName(stored.url)
          if (!name) continue
          const size = await new Promise<{ width: number; height: number }>((resolve) => {
            const url = URL.createObjectURL(file)
            const img = new Image()
            img.onload = () => {
              const scale = Math.min(1, MAX_IMAGE_CARD.width / img.naturalWidth, MAX_IMAGE_CARD.height / img.naturalHeight)
              resolve({
                width: Math.max(60, Math.round(img.naturalWidth * scale)),
                height: Math.max(40, Math.round(img.naturalHeight * scale))
              })
              URL.revokeObjectURL(url)
            }
            img.onerror = () => {
              resolve({ ...CARD_SIZE.image })
              URL.revokeObjectURL(url)
            }
            img.src = url
          })
          addCard('image', { x: centre.x + offset, y: centre.y + offset }, { file: name }, size)
          offset += 32
        } catch (e) {
          console.error('[nexus] could not add a picture to the canvas', e)
          toast.error('Could not add that picture')
        }
      }
    },
    [addCard]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return
      setEdges((current) => [
        ...current,
        {
          id: uid(),
          type: 'link',
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          data: { raw: {} }
        }
      ])
    },
    [setEdges]
  )

  // ----------------------------------------------------------------
  // Groups carry what is inside them
  // ----------------------------------------------------------------

  const carried = useRef(new Map<string, { start: { x: number; y: number }; children: Map<string, { x: number; y: number }> }>())

  const onNodeDragStart: OnNodeDrag<CardNode> = useCallback((_, __, dragged) => {
    carried.current.clear()
    const draggedIds = new Set(dragged.map((n) => n.id))
    const all = flow.getNodes()
    for (const group of dragged) {
      if (group.type !== 'group') continue
      const children = new Map<string, { x: number; y: number }>()
      for (const node of all) {
        if (draggedIds.has(node.id) || node.id === group.id) continue
        if (inside(node, group)) children.set(node.id, { ...node.position })
      }
      carried.current.set(group.id, { start: { ...group.position }, children })
    }
  }, [flow])

  const onNodeDrag: OnNodeDrag<CardNode> = useCallback((_, __, dragged) => {
    if (carried.current.size === 0) return
    const moves = new Map<string, { x: number; y: number }>()
    for (const group of dragged) {
      const entry = carried.current.get(group.id)
      if (!entry) continue
      const dx = group.position.x - entry.start.x
      const dy = group.position.y - entry.start.y
      for (const [id, pos] of entry.children) moves.set(id, { x: pos.x + dx, y: pos.y + dy })
    }
    if (moves.size === 0) return
    // Marked as dragging too, so the history effect waits for the whole move
    // rather than committing every child position along the way.
    setNodes((current) =>
      current.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)!, dragging: true } : n))
    )
  }, [setNodes])

  const onNodeDragStop: OnNodeDrag<CardNode> = useCallback(() => {
    if (carried.current.size === 0) return
    const ids = new Set<string>()
    for (const entry of carried.current.values()) for (const id of entry.children.keys()) ids.add(id)
    carried.current.clear()
    setNodes((current) => current.map((n) => (ids.has(n.id) ? { ...n, dragging: false } : n)))
  }, [setNodes])

  // ----------------------------------------------------------------
  // What cards can ask for
  // ----------------------------------------------------------------

  const actions = useMemo<CanvasActions>(
    () => ({
      editingId,
      setEditingId,
      updateCard: (id, patch) =>
        setNodes((current) => current.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
      updateLink: (id, patch: Partial<LinkData>) =>
        setEdges((current) =>
          current.map((e) => (e.id === id ? { ...e, data: { raw: {}, ...e.data, ...patch } } : e))
        ),
      setColor: (ids, color: CanvasColor | undefined) => {
        const set = new Set(ids)
        setNodes((current) => current.map((n) => (set.has(n.id) ? { ...n, data: { ...n.data, color } } : n)))
      },
      remove: (ids) => {
        const set = new Set(ids)
        setEditingId(null)
        setNodes((current) => current.filter((n) => !set.has(n.id)))
        setEdges((current) => current.filter((e) => !set.has(e.id) && !set.has(e.source) && !set.has(e.target)))
      },
      makePage: async (id) => {
        const node = flow.getNode(id)
        if (!node || node.type !== 'text') return
        const lines = (node.data.text ?? '').split('\n')
        const firstIndex = lines.findIndex((l) => l.trim())
        const title = firstIndex < 0 ? '' : lines[firstIndex].replace(/^#+\s*/, '').trim().slice(0, 120)
        const rest = firstIndex < 0 ? [] : lines.slice(firstIndex + 1)
        while (rest.length && !rest[0].trim()) rest.shift()
        const blocks = rest.map((line) => ({
          id: uid(),
          type: 'paragraph',
          props: {},
          content: line ? [{ type: 'text', text: line, styles: {} }] : [],
          children: []
        }))
        try {
          const page = await window.api.pages.create()
          const content = JSON.stringify(blocks)
          await window.api.pages.update(page.id, { title, content })
          await refreshPages()
          patchPage(page.id, { content })
          setNodes((current) =>
            current.map((n) =>
              n.id === id
                ? {
                    ...n,
                    type: 'page',
                    width: Math.max(n.width ?? 0, CARD_SIZE.page.width),
                    height: Math.max(n.height ?? 0, CARD_SIZE.page.height),
                    data: { raw: { id }, color: n.data.color, pageId: page.id }
                  }
                : n
            )
          )
          toast.success(title ? `“${title}” is a page now` : 'The card is a page now')
        } catch (e) {
          console.error('[nexus] could not make a page from a card', e)
          toast.error('Could not make a page from that card')
        }
      },
      createTextAt: (clientX, clientY) => {
        addCard('text', flow.screenToFlowPosition({ x: clientX, y: clientY }))
      },
      openPage: (pageId) => {
        void save.flush()
        storeOpenPage(pageId)
      },
      fitImage: (id, naturalWidth, naturalHeight) => {
        if (!naturalWidth || !naturalHeight) return
        setNodes((current) =>
          current.map((n) =>
            n.id === id
              ? { ...n, height: Math.round(((n.width ?? CARD_SIZE.image.width) * naturalHeight) / naturalWidth) }
              : n
          )
        )
      },
      openTitle: async (title) => {
        const wanted = title.trim().toLowerCase()
        const match = [...useAppStore.getState().pages]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .find((p) => p.title.trim().toLowerCase() === wanted)
        void save.flush()
        if (match) {
          storeOpenPage(match.id)
          return
        }
        const page = await window.api.pages.create()
        await window.api.pages.update(page.id, { title: title.trim() })
        await refreshPages()
        storeOpenPage(page.id)
      }
    }),
    [editingId, setNodes, setEdges, flow, addCard, save, storeOpenPage, refreshPages, patchPage]
  )

  // ----------------------------------------------------------------
  // Keyboard
  // ----------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.nodeName === 'INPUT' || target.nodeName === 'TEXTAREA' || target.isContentEditable || !!target.closest('.nokey'))
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape' && editingId && !typing) {
        setEditingId(null)
        return
      }
      if (typing || !mod) return
      const key = e.key.toLowerCase()

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        travel(-1)
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        travel(1)
      } else if (key === 'd') {
        // Duplicate the selection, arrows between duplicated cards included.
        const selected = flow.getNodes().filter((n) => n.selected)
        if (selected.length === 0) return
        e.preventDefault()
        const idMap = new Map(selected.map((n) => [n.id, uid()]))
        const copies: CardNode[] = selected.map((n) => ({
          ...n,
          id: idMap.get(n.id)!,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          dragging: false,
          data: { ...n.data, raw: { ...n.data.raw, id: idMap.get(n.id)! } }
        }))
        const linkCopies: LinkEdge[] = flow
          .getEdges()
          .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
          .map((edge) => ({
            ...edge,
            id: uid(),
            source: idMap.get(edge.source)!,
            target: idMap.get(edge.target)!,
            selected: false,
            data: { ...edge.data, raw: {} }
          }))
        setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...copies])
        setEdges((current) => [...current, ...linkCopies])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId, travel, flow, setNodes, setEdges])

  /**
   * Paste onto the canvas: a picture becomes an image card, plain text a text
   * card. Only when nothing that takes text has focus — a paste into a card,
   * the title or the block editor is theirs.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.nodeName === 'INPUT' || target.nodeName === 'TEXTAREA' || target.isContentEditable || target.closest('.nokey'))) return
      if (!wrapperRef.current?.isConnected) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault()
        void addImages(files, viewCentre())
        return
      }
      const text = e.clipboardData?.getData('text/plain')
      if (text && text.trim()) {
        e.preventDefault()
        const id = addCard('text', viewCentre(), { text })
        // A pasted card is finished, not a draft to keep typing into.
        setEditingId((current) => (current === id ? null : current))
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImages, addCard, viewCentre])

  // Arrowheads take the arrow's colour, which React Flow wants on the edge
  // object rather than from CSS.
  const drawnEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        markerEnd:
          edge.data?.toEnd === 'none'
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color: edge.data?.color ? `var(--nx-${edge.data.color})` : 'var(--nx-text-dim)'
              }
      })),
    [edges]
  )

  const savedViewport = useMemo(() => readViewport(canvas.id), [canvas.id])

  return (
    <CanvasContext.Provider value={actions}>
      <div
        ref={wrapperRef}
        className="nx-canvas-board"
        onDoubleClick={(e) => {
          if ((e.target as Element).classList.contains('react-flow__pane')) {
            addCard('text', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files)
          if (files.length === 0) return
          e.preventDefault()
          void addImages(files, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
      >
        <ReactFlow<CardNode, LinkEdge>
          nodes={nodes}
          edges={drawnEdges}
          nodeTypes={CARD_TYPES}
          edgeTypes={LINK_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => setEditingId(null)}
          // Clicking another card is leaving this one, as clicking canvas is.
          onNodeClick={(_, node) => {
            if (editingId && editingId !== node.id) setEditingId(null)
          }}
          onEdgeDoubleClick={(_, edge) => setEditingId(`edge:${edge.id}`)}
          onMoveEnd={(_, viewport) => writeViewport(canvas.id, viewport)}
          connectionMode={ConnectionMode.Loose}
          defaultViewport={savedViewport}
          fitView={!savedViewport}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.1}
          maxZoom={2.5}
          zoomOnDoubleClick={false}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          selectionKeyCode="Shift"
          panOnScroll={false}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
          <MiniMap
            pannable
            zoomable
            className="nx-canvas-minimap"
            nodeClassName={(n) => `nx-canvas-minimap__node nx-canvas-minimap__node--${n.type}`}
            nodeBorderRadius={2}
          />
          <Panel position="top-left" className="nx-canvas-bar">
            <button onClick={() => addCard('text', viewCentre())} title="A markdown card (or double-click the canvas)">
              + text
            </button>
            <button onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen} title="A card for one of your pages">
              + page
            </button>
            <button onClick={() => addCard('group', viewCentre())} title="A labelled region that carries what is inside it">
              + group
            </button>
            <button onClick={() => imageInput.current?.click()} title="A picture (or paste one, or drop files on the canvas)">
              + image
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void addImages(files, viewCentre())
              }}
            />
            <span className="nx-canvas-bar__sep" />
            <button onClick={() => travel(-1)} disabled={cursor.current === 0} title="Undo (Cmd/Ctrl + Z)">
              undo
            </button>
            <button
              onClick={() => travel(1)}
              disabled={cursor.current >= history.current.length - 1}
              title="Redo (Cmd/Ctrl + Shift + Z)"
            >
              redo
            </button>
            <span className="nx-canvas-bar__sep" />
            <button onClick={() => void flow.zoomOut()} aria-label="Zoom out" title="Zoom out">
              −
            </button>
            <button onClick={() => void flow.zoomIn()} aria-label="Zoom in" title="Zoom in">
              +
            </button>
            <button onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1 })} title="Fit everything">
              fit
            </button>
            {pickerOpen && (
              <PagePicker
                onClose={() => setPickerOpen(false)}
                onPick={(pageId) => {
                  setPickerOpen(false)
                  addCard('page', viewCentre(), { pageId })
                }}
              />
            )}
          </Panel>
          {nodes.length === 0 && (
            <Panel position="top-center" className="nx-canvas-hint nx-type-data">
              double-click anywhere to write a card · drag from a card's edge to draw an arrow
            </Panel>
          )}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  )
}

/** One canvas, drawn. Keyed by canvas id by its parent, so switching is a fresh board. */
export function CanvasBoard({ canvas }: { canvas: Canvas }) {
  return (
    <ReactFlowProvider>
      <Board canvas={canvas} />
    </ReactFlowProvider>
  )
}
