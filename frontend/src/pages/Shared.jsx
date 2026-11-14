import { lazy, Suspense, useMemo, useState } from 'react'
import { api } from '../api'
import { linkProps } from '../router'
import { Spinner, useAsync, Wordmark } from '../ui'
import { threadFor } from '../lib/util'
import ItemCard from '../project/ItemCard'
import BrandKitView, { isKitEmpty } from '../project/BrandKitView'

const ItemViewer = lazy(() => import('../project/ItemViewer'))
const NotesView = lazy(() => import('../project/Notes').then((m) => ({ default: m.NotesView })))

const BRIEF_LABELS = [
  ['client', 'For'],
  ['summary', 'The job'],
  ['audience', 'Audience'],
  ['goals', 'Goals'],
  ['deliverables', 'Deliverables'],
  ['constraints', 'Constraints'],
  ['tone', 'Tone'],
  ['deadline', 'Due'],
]

// What someone sees when they open a view link. No account, no editing, and
// only the sections the owner switched on for that link.
export default function Shared({ token }) {
  const shared = useAsync(() => api.shared(token), [token])
  const [tab, setTab] = useState(null)
  const [active, setActive] = useState('all')
  const [open, setOpen] = useState(null)
  const data = shared.data
  const items = useMemo(() => data?.items || [], [data])
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  if (shared.loading) return <div className="min-h-screen grid place-items-center"><Spinner /></div>
  if (shared.error) {
    return (
      <div className="min-h-screen grid place-items-center p-8 text-center">
        <div className="max-w-sm">
          <Wordmark />
          <h1 className="text-2xl mt-8 mb-2">This link doesn’t open anything</h1>
          <p className="text-mute">{shared.error.status === 429 ? shared.error.message : 'It may have been turned off by the person who sent it, or copied incompletely. Ask them for a new one.'}</p>
        </div>
      </div>
    )
  }

  const tabs = [
    data.includes.board && ['board', 'Board'],
    data.includes.brand && !isKitEmpty(data.brand) && ['brand', 'Brand kit'],
    data.includes.brief && ['brief', 'Brief'],
    data.includes.notes && data.notes && ['notes', 'Notes'],
  ].filter(Boolean)
  const current = tab || tabs[0]?.[0]
  const categories = data.categories || []
  const visible = (active === 'all' ? items : items.filter((i) => i.category_id === active)).slice().sort((a, b) => b.position - a.position || b.id - a.id)
  const openIndex = open === null ? -1 : visible.findIndex((i) => i.id === open)
  const brief = data.brief || {}

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 sm:px-10 pt-8 pb-4 max-w-[1400px] w-full mx-auto">
        <p className="text-sm text-mute mb-2">Shared with you, view only</p>
        <h1 className="text-[clamp(2rem,5vw,3.4rem)]">{data.project.name}</h1>
        {tabs.length > 1 && (
          <nav className="flex gap-1 mt-6" aria-label="Sections">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} aria-pressed={current === id} className={`px-3.5 py-1.5 rounded-full text-sm border-[1.5px] ${current === id ? 'bg-paper border-ink font-semibold' : 'border-transparent text-mute hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1 px-5 sm:px-10 pb-16 max-w-[1400px] w-full mx-auto">
        {tabs.length === 0 && <p className="text-mute">There’s nothing in this link to show yet.</p>}

        {current === 'board' && (
          <>
            {categories.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-3">
                {[{ id: 'all', name: 'Everything' }, ...categories].map((c, i) => {
                  const count = c.id === 'all' ? items.length : items.filter((it) => it.category_id === c.id).length
                  if (c.id !== 'all' && count === 0) return null
                  return (
                    <button key={c.id} onClick={() => setActive(c.id)} aria-pressed={active === c.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap border-[1.5px] ${active === c.id ? 'bg-paper border-ink font-semibold' : 'border-transparent text-mute hover:text-ink'}`}>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.id === 'all' ? '#16201d' : threadFor(i - 1) }} />
                      {c.name} <span className="text-xs opacity-70">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {items.length === 0 && <p className="text-mute">Nothing has been added to this board yet.</p>}
            <div className="columns-2 md:columns-3 xl:columns-4 gap-4">
              {visible.map((item) => (
                <ItemCard key={item.id} item={item} canEdit={false} onOpen={setOpen} onDelete={() => {}} />
              ))}
            </div>
          </>
        )}

        {current === 'brand' && <div className="sheet p-6 sm:p-12 max-w-5xl"><BrandKitView kit={data.brand} itemsById={itemsById} fallbackName={data.project.name} /></div>}

        {current === 'brief' && (
          <div className="sheet p-6 sm:p-10 max-w-3xl space-y-6">
            {BRIEF_LABELS.filter(([key]) => brief[key]).map(([key, label]) => (
              <div key={key}>
                <h2 className="text-[1.1rem] mb-1">{label}</h2>
                <p className="whitespace-pre-wrap">{brief[key]}</p>
              </div>
            ))}
            {brief.keywords?.length > 0 && <div className="flex flex-wrap gap-1.5">{brief.keywords.map((w) => <span key={w} className="chip chip-weld">{w}</span>)}</div>}
            {!BRIEF_LABELS.some(([key]) => brief[key]) && !brief.keywords?.length && <p className="text-mute">The brief hasn’t been written yet.</p>}
          </div>
        )}

        {current === 'notes' && (
          <div className="sheet p-6 sm:p-10 max-w-3xl">
            <Suspense fallback={<Spinner />}><NotesView content={data.notes} /></Suspense>
          </div>
        )}
      </main>

      <footer className="px-5 sm:px-10 py-6 flex items-center justify-between text-sm text-mute border-t border-line">
        <a {...linkProps('/')} className="no-underline"><Wordmark size={20} /></a>
        <a {...linkProps('/')} className="underline">Make a board of your own</a>
      </footer>

      <Suspense fallback={null}>
        {openIndex >= 0 && (
          <ItemViewer
            key={visible[openIndex].id}
            projectId={null}
            list={visible}
            index={openIndex}
            allItems={items}
            categories={categories}
            canEdit={false}
            readOnlyShare
            onGo={setOpen}
            onClose={() => setOpen(null)}
            onChanged={() => {}}
            onDelete={() => {}}
            onAdded={() => {}}
          />
        )}
      </Suspense>
    </div>
  )
}
