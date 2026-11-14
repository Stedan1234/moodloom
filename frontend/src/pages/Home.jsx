import { useEffect, useRef, useState } from 'react'
import { Plus, Search, UserRound, X } from 'lucide-react'
import { api } from '../api'
import { linkProps, navigate } from '../router'
import { ErrorNote, Spinner, useAsync, useToast, Wordmark } from '../ui'
import { itemLabel, KIND_LABEL, timeAgo } from '../lib/util'
import AuthDialog from '../AuthDialog'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'
}

const STAGE_LABEL = { brief: 'Brief', research: 'Research', concepts: 'Concepts', refine: 'Refining', deliver: 'Delivered' }

// Up to four of the project's references, laid out like the corner of a wall.
function Cover({ covers }) {
  if (!covers.length) {
    return (
      <div className="aspect-[16/10] bg-wall grid place-items-center text-mute text-sm">
        <span>Nothing on the wall yet</span>
      </div>
    )
  }
  const cells = covers.slice(0, 4)
  const layout = cells.length === 1 ? 'grid-cols-1' : cells.length === 2 ? 'grid-cols-2' : cells.length === 3 ? 'grid-cols-[1.4fr_1fr] grid-rows-2' : 'grid-cols-[1.4fr_1fr] grid-rows-[1.4fr_1fr]'
  return (
    <div className={`aspect-[16/10] grid gap-0.5 bg-paper ${layout}`}>
      {cells.map((c, i) => (
        <div key={i} className={`overflow-hidden min-h-0 ${cells.length === 3 && i === 0 ? 'row-span-2' : ''}`} style={{ background: c.color || '#d9dcd6' }}>
          {c.url && <img src={c.url} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </div>
      ))}
    </div>
  )
}

function SearchPanel({ onClose }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState({ items: null, error: null, loading: false })
  const seq = useRef(0)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return setState({ items: null, error: null, loading: false })
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true }))
    const t = setTimeout(() => {
      api
        .search(term)
        .then((items) => mine === seq.current && setState({ items, error: null, loading: false }))
        .catch((error) => mine === seq.current && setState({ items: null, error: error.message, loading: false }))
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-ink/45 anim-fade p-3 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-paper rounded-xl max-w-2xl mx-auto shadow-2xl anim-rise overflow-hidden" role="dialog" aria-label="Search your references">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search size={18} className="text-mute shrink-0" />
          <input
            autoFocus
            className="flex-1 py-4 bg-transparent outline-none text-base"
            placeholder="Search titles, notes, tags and links across every project"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto scroll-thin">
          {state.loading && (
            <div className="p-5">
              <Spinner label="Searching" />
            </div>
          )}
          {state.error && <div className="p-4"><ErrorNote>{state.error}</ErrorNote></div>}
          {state.items?.length === 0 && !state.loading && <p className="p-5 text-mute">Nothing matches “{q.trim()}”. Notes and tags you add to references are searched too.</p>}
          {state.items?.map((item) => (
            <a
              key={item.id}
              {...linkProps(`/p/${item.project_id}?item=${item.id}`)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink/5 no-underline"
            >
              <span className="w-12 h-12 rounded shrink-0 overflow-hidden bg-wall" style={{ background: item.palette?.[0]?.hex }}>
                {item.thumbnail_url && <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{itemLabel(item)}</span>
                <span className="block truncate text-sm text-mute">
                  {KIND_LABEL[item.media_type]} in {item.project_name}
                  {item.tags?.length ? `, tagged ${item.tags.slice(0, 3).join(', ')}` : ''}
                </span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const toast = useToast()
  const projects = useAsync(() => api.projects(), [])
  const account = useAsync(() => api.account(), [])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [searching, setSearching] = useState(false)
  const [auth, setAuth] = useState(null)

  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching(true)
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  async function create(e) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const project = await api.createProject(name.trim())
      navigate(`/p/${project.id}`)
    } catch (err) {
      setError(err.message)
      setCreating(false)
    }
  }

  const list = projects.data || []
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-3 px-5 sm:px-10 py-4">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          <button className="btn btn-plain" onClick={() => setSearching(true)}>
            <Search size={16} />
            <span className="hidden sm:inline">Search references</span>
            <kbd className="hidden md:inline text-xs text-mute ml-1">Ctrl K</kbd>
          </button>
          <a className="btn btn-quiet" {...linkProps('/account')}>
            <UserRound size={17} />
            <span className="hidden sm:inline">{account.data?.displayName || account.data?.email || 'Account'}</span>
          </a>
        </div>
      </header>

      <main className="px-5 sm:px-10 pb-16 max-w-[1320px] mx-auto">
        {account.data && !account.data.claimed && list.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 bg-weld-soft rounded-lg px-4 py-3">
            <p className="flex-1 min-w-[16rem] text-sm">
              <strong>These projects live only in this browser.</strong> Save your account to open them anywhere and get back in if this browser forgets you.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => setAuth('save')}>
                Save my account
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setAuth('login')}>
                Log in instead
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4 mt-4 mb-6">
          <div>
            <p className="text-mute mb-1">{greeting()}{account.data?.displayName ? `, ${account.data.displayName.split(' ')[0]}` : ''}.</p>
            <h1 className="text-[clamp(2rem,4.5vw,3rem)]">
              Your <span className="swipe">walls</span>
            </h1>
          </div>
          <form onSubmit={create} className="flex gap-2 w-full sm:w-auto">
            <input
              className="field sm:w-72"
              placeholder="Name a new project"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-label="New project name"
            />
            <button className="btn btn-primary" disabled={creating || !name.trim()}>
              <Plus size={17} /> Create
            </button>
          </form>
        </div>
        <div className="mb-5 max-w-md"><ErrorNote>{error || projects.error?.message}</ErrorNote></div>

        {projects.loading && <Spinner />}

        {!projects.loading && !projects.error && list.length === 0 && (
          <div className="sheet p-8 sm:p-12 max-w-2xl">
            <h2 className="text-2xl mb-2">Start with the project you’re about to design</h2>
            <p className="text-mute mb-1">
              Give it the name you’d give the folder. It starts with four groupings you can rename, and everything you save for it lands on its own wall.
            </p>
            <p className="text-mute">Type a name above and press Create.</p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => (
            <a key={p.id} {...linkProps(`/p/${p.id}`)} className="pin no-underline block">
              <Cover covers={p.covers} />
              <div className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[1.12rem] leading-tight break-words">{p.name}</h2>
                  {p.role !== 'owner' && <span className="chip shrink-0">{p.role === 'editor' ? 'Shared, can edit' : 'Shared, view only'}</span>}
                </div>
                <p className="text-sm text-mute mt-1.5">
                  {p.item_count} {p.item_count === 1 ? 'reference' : 'references'}, {STAGE_LABEL[p.stage] || p.stage}, {timeAgo(p.updated_at)}
                </p>
              </div>
            </a>
          ))}
        </div>
      </main>

      {searching && <SearchPanel onClose={() => setSearching(false)} />}
      {auth && (
        <AuthDialog
          mode={auth}
          onClose={() => setAuth(null)}
          onDone={(what) => {
            setAuth(null)
            if (what === 'saved') {
              toast('Account saved. You can log in from any browser now.')
              account.reload()
            } else {
              window.location.assign('/')
            }
          }}
        />
      )}
    </div>
  )
}
