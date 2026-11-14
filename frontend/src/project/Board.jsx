import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, Maximize2, Minimize2, NotebookPen, Plus, Quote, Search, Upload, X } from 'lucide-react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Modal, Spinner, useToast } from '../ui'
import { threadFor } from '../lib/util'
import ItemCard from './ItemCard'
import Notes from './Notes'

const ItemViewer = lazy(() => import('./ItemViewer'))

const LAYOUT_KEY = 'moodloom_layout'
function readLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    return ['split', 'notes', 'board'].includes(saved) ? saved : 'split'
  } catch {
    return 'split'
  }
}

// The category tabs. Each category is a thread with its own dye colour.
function Threads({ categories, items, active, onSelect, canEdit, onCreate, onRename, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const counts = useMemo(() => {
    const map = new Map()
    for (const it of items) map.set(it.category_id ?? 'loose', (map.get(it.category_id ?? 'loose') || 0) + 1)
    return map
  }, [items])
  const loose = counts.get('loose') || 0

  const tab = (key, label, count, color, extra) => {
    const on = active === key
    return (
      <span key={key} className="relative group/tab shrink-0">
        <button
          onClick={() => onSelect(key)}
          onDoubleClick={extra?.onRename}
          className={`flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-sm whitespace-nowrap border-[1.5px] ${
            on ? 'bg-paper border-ink font-semibold' : 'border-transparent text-mute hover:text-ink hover:bg-paper/60'
          }`}
          aria-pressed={on}
          title={extra ? 'Double-click to rename' : undefined}
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          {label}
          <span className={`text-xs ${on ? 'text-mute font-normal' : 'opacity-70'}`}>{count}</span>
        </button>
        {extra && canEdit && on && (
          <button
            onClick={extra.onDelete}
            className="absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full bg-ink text-white grid place-items-center"
            title={`Remove the “${label}” thread. Its references stay on the board.`}
            aria-label={`Remove category ${label}`}
          >
            <X size={10} />
          </button>
        )}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto scroll-thin py-2 -mx-1 px-1">
      {tab('all', 'Everything', items.length, '#16201d')}
      {categories.map((c, i) =>
        editing === c.id ? (
          <form
            key={c.id}
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && name.trim() !== c.name) onRename(c.id, name.trim())
              setEditing(null)
            }}
          >
            <input autoFocus className="field !py-1 !w-44 !rounded-full text-sm" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} aria-label="Category name" />
          </form>
        ) : (
          tab(c.id, c.name, counts.get(c.id) || 0, threadFor(i), {
            onRename: canEdit ? () => { setEditing(c.id); setName(c.name) } : undefined,
            onDelete: () => onDelete(c),
          })
        )
      )}
      {loose > 0 && categories.length > 0 && tab('loose', 'Loose', loose, '#9aa29c')}
      {canEdit &&
        (adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) onCreate(name.trim())
              setAdding(false)
              setName('')
            }}
          >
            <input autoFocus className="field !py-1 !w-44 !rounded-full text-sm" placeholder="Name the thread" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => { setAdding(false); setName('') }} aria-label="New category name" />
          </form>
        ) : (
          <button className="btn btn-quiet btn-sm shrink-0" onClick={() => { setAdding(true); setName('') }}>
            <Plus size={14} /> Thread
          </button>
        ))}
    </div>
  )
}

function PassageDialog({ onClose, onSave }) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  return (
    <Modal title="Add a passage" onClose={onClose}>
      <form
        className="space-y-3.5"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await onSave({ text: text.trim(), title: title.trim() || undefined })
            onClose()
          } catch (err) {
            setError(err.message)
            setBusy(false)
          }
        }}
      >
        <p className="hint">A line from the brief, something the client said, a sentence from a book. Words belong on the wall too.</p>
        <textarea className="field !min-h-32" required maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste the words" />
        <input className="field" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Where it’s from (optional)" />
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary w-full" disabled={busy || !text.trim()}>
          Add to board
        </button>
      </form>
    </Modal>
  )
}

export default function Board({ project, projectId, items, categories, canEdit, loadItems, loadCategories, setItems, setCategories, pendingDeletes, openItemId }) {
  const toast = useToast()
  const [active, setActive] = useState('all')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [layout, setLayoutState] = useState(readLayout)
  const [dropping, setDropping] = useState(false)
  const [passage, setPassage] = useState(false)
  const [dragId, setDragId] = useState(null)
  const fileRef = useRef(null)
  const activeRef = useRef(active)
  activeRef.current = active

  const setLayout = (next) => {
    setLayoutState(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      /* a convenience only */
    }
  }
  const targetCategory = () => (typeof activeRef.current === 'number' ? activeRef.current : null)

  // A category deleted elsewhere shouldn't leave this tab pointing at nothing.
  useEffect(() => {
    if (typeof active === 'number' && !categories.some((c) => c.id === active)) setActive('all')
  }, [categories, active])

  async function addUrl(e) {
    e.preventDefault()
    const value = url.trim()
    if (!value) return
    setAdding(true)
    setError(null)
    try {
      const result = await api.capture(projectId, { sourceUrl: /^https?:\/\//i.test(value) ? value : `https://${value}`, categoryId: targetCategory() })
      setUrl('')
      if (result.alreadyOnBoard) toast('That’s already on this board.')
      await loadItems()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function uploadFiles(files) {
    const list = Array.from(files || []).slice(0, 30)
    if (!list.length) return
    setError(null)
    let failed = 0
    let lastError = null
    for (let i = 0; i < list.length; i++) {
      setUploading({ done: i, total: list.length })
      try {
        await api.upload(projectId, list[i], { categoryId: targetCategory() })
      } catch (err) {
        failed++
        lastError = err.message
      }
    }
    setUploading(null)
    await loadItems()
    if (failed) setError(list.length === 1 ? lastError : `${failed} of ${list.length} files couldn’t be added. Last reason: ${lastError}`)
    else toast(list.length === 1 ? 'Added to the board.' : `${list.length} files added to the board.`)
  }
  const uploadRef = useRef(uploadFiles)
  uploadRef.current = uploadFiles

  // Paste a screenshot anywhere on the board. Not while typing in a field or
  // the notes: a paste there is text.
  useEffect(() => {
    if (!canEdit) return
    function onPaste(e) {
      const t = e.target
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      const files = Array.from(e.clipboardData?.items || [])
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter(Boolean)
      if (files.length) {
        e.preventDefault()
        uploadRef.current(files)
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (text && /^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault()
        setUrl(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [canEdit])

  async function removeItem(id) {
    pendingDeletes.current.add(id)
    setItems((prev) => (prev || []).filter((i) => i.id !== id))
    try {
      await api.deleteItem(projectId, id)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      pendingDeletes.current.delete(id)
      loadItems({ quiet: true })
    }
  }

  async function createCategory(name) {
    try {
      const created = await api.createCategory(projectId, name)
      setCategories((prev) => [...prev, created])
      setActive(created.id)
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  async function renameCategory(id, name) {
    try {
      const updated = await api.updateCategory(projectId, id, { name })
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)))
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  async function deleteCategory(category) {
    if (!window.confirm(`Remove the “${category.name}” thread? Its references stay on the board, loose.`)) return
    setCategories((prev) => prev.filter((c) => c.id !== category.id))
    setActive('all')
    try {
      await api.deleteCategory(projectId, category.id)
      await loadItems()
    } catch (err) {
      toast(err.message, 'error')
      loadCategories()
    }
  }

  const threadOf = useMemo(() => new Map(categories.map((c, i) => [c.id, threadFor(i)])), [categories])
  const inCategory = active === 'all' ? items : active === 'loose' ? items.filter((i) => i.category_id === null) : items.filter((i) => i.category_id === active)
  const term = filter.trim().toLowerCase()
  const visible = term
    ? inCategory.filter((i) => [i.title, i.note, i.file_name, i.source_url, ...(i.tags || [])].some((v) => v && String(v).toLowerCase().includes(term)))
    : inCategory
  // Newest first reads better on a wall you keep adding to; position decides.
  const ordered = useMemo(() => [...visible].sort((a, b) => b.position - a.position || b.id - a.id), [visible])

  // Drag one card onto another to move it there.
  async function dropOn(targetId) {
    const moving = dragId
    setDragId(null)
    if (!moving || moving === targetId || term) return
    const all = [...items].sort((a, b) => b.position - a.position || b.id - a.id)
    const from = all.findIndex((i) => i.id === moving)
    const to = all.findIndex((i) => i.id === targetId)
    if (from < 0 || to < 0) return
    const [moved] = all.splice(from, 1)
    all.splice(to, 0, moved)
    // Positions ascend from the bottom of the wall, so send the ids reversed.
    const idsAscending = all.map((i) => i.id).reverse()
    setItems(all.map((it, index) => ({ ...it, position: all.length - 1 - index })))
    try {
      await api.reorder(projectId, idsAscending)
    } catch (err) {
      toast(err.message, 'error')
      loadItems()
    }
  }

  const openItem = (id) => navigate(`/p/${projectId}?item=${id}`, { replace: Boolean(openItemId) })
  const closeItem = () => navigate(`/p/${projectId}`, { replace: true })
  const openIndex = openItemId ? ordered.findIndex((i) => String(i.id) === String(openItemId)) : -1
  // An item opened from search may sit outside the current tab or filter.
  const openedElsewhere = openItemId && openIndex < 0 ? items.find((i) => String(i.id) === String(openItemId)) : null
  const viewerList = openedElsewhere ? [openedElsewhere] : ordered
  const viewerIndex = openedElsewhere ? 0 : openIndex

  const cols = layout === 'board' ? 'columns-2 md:columns-3 xl:columns-4 2xl:columns-5' : 'columns-2 xl:columns-3'
  const boardHidden = layout === 'notes'
  const notesHidden = layout === 'board'

  return (
    <div
      className="h-full flex relative"
      onDragEnter={(e) => {
        if (canEdit && e.dataTransfer?.types?.includes('Files')) setDropping(true)
      }}
    >
      {/* the wall */}
      <section className={`min-w-0 flex-col ${boardHidden ? 'hidden md:flex md:w-12 md:flex-none' : 'flex flex-1'}`} aria-label="Reference board">
        {boardHidden ? (
          <button onClick={() => setLayout('split')} className="h-full w-12 flex flex-col items-center gap-3 pt-4 text-mute hover:text-ink hover:bg-paper/60 border-r border-line" title="Show the board">
            <ChevronsRight size={18} />
            <span className="text-xs [writing-mode:vertical-rl]">Board, {items.length} references</span>
          </button>
        ) : (
          <>
            <div className="px-3 sm:px-5 pt-3 no-print">
              {canEdit && (
                <form onSubmit={addUrl} className="flex gap-2">
                  <input
                    className="field flex-1 min-w-0"
                    placeholder="Paste a link, or drop files anywhere on the board"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label="Link to add"
                    inputMode="url"
                  />
                  <button className="btn btn-primary" disabled={adding || !url.trim()}>
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      uploadFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  <button type="button" className="btn btn-plain" onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)} title="Images, video, PDF, fonts, design files">
                    <Upload size={16} />
                    <span className="hidden lg:inline">{uploading ? `Adding ${uploading.done + 1} of ${uploading.total}` : 'Upload'}</span>
                  </button>
                  <button type="button" className="btn btn-plain" onClick={() => setPassage(true)} title="Add a passage of text">
                    <Quote size={16} />
                    <span className="hidden xl:inline">Passage</span>
                  </button>
                </form>
              )}
              <div className="mt-2 empty:hidden"><ErrorNote>{error}</ErrorNote></div>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Threads
                    categories={categories}
                    items={items}
                    active={active}
                    onSelect={setActive}
                    canEdit={canEdit}
                    onCreate={createCategory}
                    onRename={renameCategory}
                    onDelete={deleteCategory}
                  />
                </div>
                <label className="relative hidden sm:block shrink-0">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
                  <input className="field !py-1.5 !pl-8 !w-40 focus:!w-56 transition-[width] text-sm" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter this board" />
                </label>
                <div className="hidden md:flex shrink-0">
                  {layout === 'board' ? (
                    <button className="btn btn-quiet btn-icon" onClick={() => setLayout('split')} title="Show notes beside the board" aria-label="Show notes beside the board">
                      <Minimize2 size={16} />
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-quiet btn-icon" onClick={() => setLayout('notes')} title="Tuck the board away" aria-label="Tuck the board away">
                        <ChevronsLeft size={16} />
                      </button>
                      <button className="btn btn-quiet btn-icon" onClick={() => setLayout('board')} title="Board only" aria-label="Board only">
                        <Maximize2 size={16} />
                      </button>
                    </>
                  )}
                </div>
                <button className="md:hidden btn btn-quiet btn-icon" onClick={() => setLayout('notes')} aria-label="Open notes">
                  <NotebookPen size={17} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scroll-thin px-3 sm:px-5 pt-2 pb-10">
              {items.length === 0 && (
                <div className="max-w-md mt-10 mx-auto text-center">
                  <h2 className="text-2xl mb-2">A bare wall</h2>
                  <p className="text-mute">
                    {canEdit
                      ? 'Paste a link above, drop in files, or paste a screenshot with Ctrl/Cmd + V. With the browser extension, one click on any page sends it here.'
                      : 'Nothing has been added to this board yet.'}
                  </p>
                </div>
              )}
              {items.length > 0 && ordered.length === 0 && (
                <p className="text-mute mt-8 text-center">{term ? `Nothing here matches “${filter.trim()}”.` : 'Nothing on this thread yet. What you add while it’s selected lands here.'}</p>
              )}
              <div className={`${cols} gap-4`}>
                {ordered.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    thread={active === 'all' && item.category_id ? threadOf.get(item.category_id) : null}
                    canEdit={canEdit}
                    onOpen={openItem}
                    onDelete={removeItem}
                    dimmed={dragId === item.id}
                    dragProps={
                      canEdit && !term
                        ? {
                            draggable: true,
                            onDragStart: (e) => {
                              e.dataTransfer.setData('application/x-moodloom-item', String(item.id))
                              e.dataTransfer.effectAllowed = 'move'
                              setDragId(item.id)
                            },
                            onDragEnd: () => setDragId(null),
                            onDragOver: (e) => dragId && e.preventDefault(),
                            onDrop: (e) => {
                              if (!dragId) return
                              e.preventDefault()
                              dropOn(item.id)
                            },
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* notes beside it */}
      <aside
        className={`${notesHidden ? 'hidden' : layout === 'notes' ? 'flex flex-1' : 'hidden md:flex md:w-[380px] xl:w-[440px] md:flex-none'} min-w-0 flex-col border-l border-line bg-paper`}
        aria-label="Project notes"
      >
        <Notes projectId={projectId} canEdit={canEdit} wide={layout === 'notes'} onClose={layout === 'notes' ? () => setLayout('split') : null} />
      </aside>

      {dropping && (
        <div
          className="absolute inset-0 z-30 bg-spruce/90 text-paper grid place-items-center anim-fade"
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => e.target === e.currentTarget && setDropping(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            uploadFiles(e.dataTransfer.files)
          }}
        >
          <div className="text-center pointer-events-none">
            <Upload size={34} className="mx-auto mb-3 text-weld" />
            <p className="display text-3xl">Drop to pin it up</p>
            <p className="opacity-80 mt-1">Images, video, PDF, fonts and design files</p>
          </div>
        </div>
      )}

      {passage && (
        <PassageDialog
          onClose={() => setPassage(false)}
          onSave={async (data) => {
            await api.addQuote(projectId, { ...data, categoryId: targetCategory() })
            await loadItems()
          }}
        />
      )}

      <Suspense fallback={<div className="fixed inset-0 z-50 bg-ink/80 grid place-items-center"><Spinner /></div>}>
        {viewerIndex >= 0 && (
          <ItemViewer
            key={viewerList[viewerIndex].id}
            project={project}
            projectId={projectId}
            list={viewerList}
            index={viewerIndex}
            allItems={items}
            categories={categories}
            canEdit={canEdit}
            onGo={openItem}
            onClose={closeItem}
            onChanged={(updated) => setItems((prev) => (prev || []).map((i) => (i.id === updated.id ? updated : i)))}
            onDelete={(id) => {
              closeItem()
              removeItem(id)
            }}
            onAdded={() => loadItems()}
          />
        )}
      </Suspense>
    </div>
  )
}
