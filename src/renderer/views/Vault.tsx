import { useEffect, useState } from 'react'
import type { Page } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { Icon } from '../design/Icon'
import { Editor } from '../editor/Editor'
import { PropertiesPanel } from './PropertiesPanel'
import { BacklinksPanel } from './BacklinksPanel'
import './Vault.css'

export function Vault() {
  const activePageId = useAppStore((s) => s.activePageId)
  const setActivePageId = useAppStore((s) => s.setActivePageId)

  const [pages, setPages] = useState<Page[]>([])
  const [trashedPages, setTrashedPages] = useState<Page[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const [all, deleted] = await Promise.all([window.api.pages.getAll(), window.api.pages.getDeleted()])
    setPages(all)
    setTrashedPages(deleted)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const activePage = pages.find((p) => p.id === activePageId) ?? null

  const createPage = async () => {
    const page = await window.api.pages.create()
    await refresh()
    setActivePageId(page.id)
  }

  const softDelete = async (id: string) => {
    await window.api.pages.softDelete(id)
    if (activePageId === id) setActivePageId(null)
    await refresh()
  }

  const duplicate = async (id: string) => {
    const copy = await window.api.pages.duplicate(id)
    await refresh()
    setActivePageId(copy.id)
  }

  const restore = async (id: string) => {
    await window.api.pages.restore(id)
    await refresh()
  }

  const hardDelete = async (id: string) => {
    await window.api.pages.hardDelete(id)
    await refresh()
  }

  const list = showTrash ? trashedPages : pages

  return (
    <div className="nx-vault">
      <div className="nx-vault__list">
        <div className="nx-vault__list-header">
          <span className="nx-type-label">{showTrash ? 'Trash' : 'Pages'}</span>
          {!showTrash && (
            <Button variant="ghost" onClick={createPage}>
              + New
            </Button>
          )}
        </div>

        {loading ? (
          <div className="nx-type-data">loading...</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon="square"
            text={showTrash ? 'Trash is empty' : 'No pages yet'}
            meta={showTrash ? undefined : 'create one to get started'}
          />
        ) : (
          <div className="nx-vault__items">
            {list.map((page) => (
              <div
                key={page.id}
                className={`nx-vault__item ${page.id === activePageId ? 'nx-vault__item--active' : ''}`}
                onClick={() => !showTrash && setActivePageId(page.id)}
              >
                <span className="nx-vault__item-title">{page.title || 'Untitled'}</span>
                {showTrash ? (
                  <span className="nx-vault__trash-actions">
                    <button onClick={() => restore(page.id)}>restore</button>
                    <button onClick={() => hardDelete(page.id)}>delete</button>
                  </span>
                ) : (
                  <span className="nx-vault__item-actions">
                    <button
                      className="nx-vault__item-delete"
                      aria-label="Duplicate"
                      title="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation()
                        duplicate(page.id)
                      }}
                    >
                      <Icon shape="diamond" size={11} />
                    </button>
                    <button
                      className="nx-vault__item-delete"
                      aria-label="Move to trash"
                      title="Move to trash"
                      onClick={(e) => {
                        e.stopPropagation()
                        softDelete(page.id)
                      }}
                    >
                      <Icon shape="square" size={11} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <button className="nx-vault__trash-toggle nx-type-data" onClick={() => setShowTrash((v) => !v)}>
          {showTrash ? '← back to pages' : `trash (${trashedPages.length})`}
        </button>
      </div>

      <div className="nx-vault__main">
        <div className="nx-vault__main-header">
          {activePage && (
            <span className="nx-type-data">
              {saveStatus === 'saving' ? 'saving…' : saveStatus === 'saved' ? 'saved' : ''}
            </span>
          )}
        </div>
        <Panel>
          {activePage ? (
            <Editor
              key={activePage.id}
              page={activePage}
              onTitleChange={(title) => setPages((prev) => prev.map((p) => (p.id === activePage.id ? { ...p, title } : p)))}
              onSaveStatusChange={setSaveStatus}
            />
          ) : null}
          {activePage && <PropertiesPanel page={activePage} />}
          {activePage && <BacklinksPanel pageId={activePage.id} />}
          {!activePage && (
            <EmptyState icon="square" text="No page selected" meta="pick one from the list, or create a new one" />
          )}
        </Panel>
      </div>
    </div>
  )
}
