import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Compass, Download, FileText, LayoutGrid, MoreHorizontal, Palette, PenLine, Share2, Trash2, Pencil } from 'lucide-react'
import { api } from '../api'
import { linkProps, navigate } from '../router'
import { ErrorNote, Mark, Menu, MenuItem, Modal, Spinner, useToast } from '../ui'
import Board from '../project/Board'

const Brief = lazy(() => import('../project/Brief'))
const Direction = lazy(() => import('../project/Direction'))
const Sketch = lazy(() => import('../project/Sketch'))
const BrandKit = lazy(() => import('../project/BrandKit'))
const ShareDialog = lazy(() => import('../project/ShareDialog'))

const TABS = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'brief', label: 'Brief', icon: FileText },
  { id: 'direction', label: 'Direction', icon: Compass },
  { id: 'sketch', label: 'Sketch', icon: PenLine },
  { id: 'brand', label: 'Brand kit', icon: Palette },
]
const STAGES = [
  ['brief', 'Brief'],
  ['research', 'Research'],
  ['concepts', 'Concepts'],
  ['refine', 'Refining'],
  ['deliver', 'Delivered'],
]
const POLL_MS = 5000

export default function Project({ projectId, tab, openItemId }) {
  const toast = useToast()
  const [project, setProject] = useState(null)
  const [items, setItems] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Items the user has just removed, so a poll that lands before the server
  // confirms can't bring them back for a moment.
  const pendingDeletes = useRef(new Set())

  const loadItems = useCallback(
    async ({ quiet = false } = {}) => {
      try {
        const fresh = (await api.items(projectId)).filter((i) => !pendingDeletes.current.has(i.id))
        setItems((prev) => (prev && JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
      } catch (err) {
        if (!quiet) setError(err.message)
      }
    },
    [projectId]
  )
  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.categories(projectId))
    } catch (err) {
      setError(err.message)
    }
  }, [projectId])

  useEffect(() => {
    api.project(projectId).then(setProject).catch((err) => setError(err.status === 404 ? 'That project doesn’t exist, or you don’t have access to it.' : err.message))
    loadItems()
    loadCategories()
    // New captures from the extension or a phone appear without a refresh.
    const timer = setInterval(() => document.visibilityState === 'visible' && loadItems({ quiet: true }), POLL_MS)
    return () => clearInterval(timer)
  }, [projectId, loadItems, loadCategories])

  useEffect(() => {
    if (project) document.title = `${project.name} · Moodloom`
    return () => {
      document.title = 'Moodloom'
    }
  }, [project])

  const canEdit = project && project.role !== 'viewer'
  const isOwner = project?.role === 'owner'

  async function changeProject(changes) {
    try {
      setProject(await api.updateProject(projectId, changes))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function exportZip() {
    toast('Preparing the download…')
    try {
      await api.exportProject(projectId)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  if (error && !project) {
    return (
      <div className="min-h-screen grid place-items-center p-8 text-center">
        <div className="max-w-sm">
          <h1 className="text-2xl mb-3">Can’t open this project</h1>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary mt-5" onClick={() => navigate('/')}>
            Back to your projects
          </button>
        </div>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    )
  }

  const shared = { project, projectId, items: items || [], categories, canEdit, isOwner, loadItems, loadCategories, setItems, setCategories, pendingDeletes, changeProject }

  return (
    <div className="h-dvh flex flex-col">
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 border-b border-line bg-paper no-print">
        <a {...linkProps('/')} className="btn btn-quiet btn-icon shrink-0 !w-auto !px-1.5" aria-label="All projects" title="All projects">
          <ChevronLeft size={18} />
          <Mark size={22} />
        </a>
        <h1 className="text-[1.15rem] sm:text-[1.3rem] truncate min-w-0" title={project.name}>
          {project.name}
        </h1>
        {canEdit ? (
          <select
            className="hidden sm:block bg-transparent text-sm text-mute border border-line rounded-full px-2.5 py-1 hover:border-ink cursor-pointer"
            value={project.stage}
            onChange={(e) => changeProject({ stage: e.target.value })}
            aria-label="Project stage"
          >
            {STAGES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <span className="chip">View only</span>
        )}
        <div className="flex-1" />
        {isOwner && (
          <button className="btn btn-plain btn-sm" onClick={() => setSharing(true)}>
            <Share2 size={15} /> <span className="hidden sm:inline">Share</span>
          </button>
        )}
        <Menu
          button={({ toggle }) => (
            <button className="btn btn-quiet btn-icon" onClick={toggle} aria-label="Project menu">
              <MoreHorizontal size={19} />
            </button>
          )}
        >
          <MenuItem icon={Download} onClick={exportZip}>
            Download project as ZIP
          </MenuItem>
          {isOwner && (
            <>
              <MenuItem icon={Pencil} onClick={() => setRenaming(true)}>
                Rename project
              </MenuItem>
              <MenuItem icon={Trash2} danger onClick={() => setDeleting(true)}>
                Delete project
              </MenuItem>
            </>
          )}
        </Menu>
      </header>

      <div className="flex-1 min-h-0 flex flex-col-reverse md:flex-row">
        <nav className="shrink-0 bg-paper border-t md:border-t-0 md:border-r border-line flex md:flex-col md:w-[76px] md:py-3 md:gap-1 justify-around md:justify-start no-print" aria-label="Project sections">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <a
                key={t.id}
                {...linkProps(t.id === 'board' ? `/p/${projectId}` : `/p/${projectId}/${t.id}`)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 px-2 py-2 md:py-2.5 text-[11px] font-medium no-underline flex-1 md:flex-none ${
                  active ? 'text-ink' : 'text-mute hover:text-ink'
                }`}
              >
                <span className={`grid place-items-center w-10 h-8 rounded-lg ${active ? 'bg-weld' : ''}`}>
                  <t.icon size={18} />
                </span>
                {t.label}
              </a>
            )
          })}
        </nav>

        <main className="flex-1 min-w-0 min-h-0 relative">
          <Suspense
            fallback={
              <div className="h-full grid place-items-center">
                <Spinner />
              </div>
            }
          >
            {tab === 'board' && <Board {...shared} openItemId={openItemId} />}
            {tab === 'brief' && <Brief {...shared} />}
            {tab === 'direction' && <Direction {...shared} />}
            {tab === 'sketch' && <Sketch {...shared} />}
            {tab === 'brand' && <BrandKit {...shared} />}
            {!TABS.some((t) => t.id === tab) && <p className="p-8 text-mute">There’s no section called “{tab}”.</p>}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>{sharing && <ShareDialog project={project} onClose={() => setSharing(false)} />}</Suspense>
      {renaming && <RenameDialog project={project} onClose={() => setRenaming(false)} onSave={(name) => changeProject({ name })} />}
      {deleting && <DeleteDialog project={project} onClose={() => setDeleting(false)} />}
    </div>
  )
}

function RenameDialog({ project, onClose, onSave }) {
  const [name, setName] = useState(project.name)
  return (
    <Modal title="Rename project" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (name.trim()) await onSave(name.trim())
          onClose()
        }}
        className="space-y-4"
      >
        <input className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        <button className="btn btn-primary w-full" disabled={!name.trim()}>
          Save name
        </button>
      </form>
    </Modal>
  )
}

function DeleteDialog({ project, onClose }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  return (
    <Modal title="Delete this project?" onClose={onClose}>
      <div className="space-y-4">
        <p>
          This removes <strong>{project.name}</strong>, every reference on its board, its notes, sketch and brand kit, for everyone it’s shared with. It can’t be undone.
        </p>
        <p className="hint">Download it as a ZIP first if you might want it later.</p>
        <label className="block">
          <span className="label">Type the project name to confirm</span>
          <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-danger w-full"
          disabled={busy || typed.trim() !== project.name.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await api.deleteProject(project.id)
              navigate('/', { replace: true })
            } catch (err) {
              setError(err.message)
              setBusy(false)
            }
          }}
        >
          Delete project
        </button>
      </div>
    </Modal>
  )
}
