import { useEffect, useMemo, useState } from 'react'
import { Copy, Layers, Search, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Spinner, Swatch, Toggle, useAsync, useToast } from '../ui'
import { copyText, itemLabel, timeAgo } from '../lib/util'

function Thumb({ item, projectId, size = 'w-14 h-14' }) {
  if (!item) return null
  return (
    <button
      onClick={() => navigate(`/p/${projectId}?item=${item.id}`)}
      className={`${size} rounded overflow-hidden bg-wall shrink-0 hover:ring-2 ring-weld`}
      style={{ background: item.palette?.[0]?.hex }}
      title={itemLabel(item)}
    >
      {item.thumbnail_url ? <img src={item.thumbnail_url} alt={itemLabel(item)} loading="lazy" className="w-full h-full object-cover" /> : <span className="text-[10px] p-1 block text-left leading-tight line-clamp-3">{itemLabel(item)}</span>}
    </button>
  )
}

// What the references have in common, worked out from their own colours and
// the designer's own tags. No model is involved and nothing leaves the server.
function Digest({ projectId, categories }) {
  const [categoryId, setCategoryId] = useState('')
  const digest = useAsync(() => api.digest(projectId, categoryId || null), [projectId, categoryId])
  const d = digest.data
  return (
    <section className="sheet p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-[1.35rem]">What the wall shares</h3>
        <select className="field !w-auto !py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Which references to read">
          <option value="">Everything</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {digest.loading && <Spinner />}
      <ErrorNote>{digest.error?.message}</ErrorNote>
      {d && d.analysedCount === 0 && (
        <p className="text-mute">
          {d.itemCount === 0 ? 'Nothing here yet. Add references to the board and this fills in.' : 'These references have no images to read colour from yet. New ones are analysed a few seconds after they’re added.'}
        </p>
      )}
      {d && d.analysedCount > 0 && (
        <div className="space-y-5">
          <div>
            <div className="flex gap-1.5 h-20">
              {d.palette.map((c) => (
                <Swatch key={c.hex} {...c} size="lg" />
              ))}
            </div>
            <div className="flex gap-1.5 mt-1.5 text-xs text-mute">
              {d.palette.map((c) => (
                <span key={c.hex} className="min-w-0 truncate" style={{ flexGrow: Math.max(c.pct, 6), flexBasis: 0 }}>
                  {c.name}
                </span>
              ))}
            </div>
          </div>
          <p>
            Read from {d.analysedCount} of {d.itemCount} references.
            {d.traits.length > 0 && (
              <>
                {' '}
                Most of them lean{' '}
                {d.traits.map((t, i) => (
                  <span key={t.trait}>
                    {i > 0 && (i === d.traits.length - 1 ? ' and ' : ', ')}
                    <strong>{t.trait}</strong> ({t.share}%)
                  </span>
                ))}
                .
              </>
            )}{' '}
            {d.notedCount > 0 ? `${d.notedCount} have a note saying why they’re here.` : 'None has a note yet saying why it’s here.'}
          </p>
          {d.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.tags.map((t) => (
                <span key={t.tag} className="chip">
                  {t.tag} <span className="text-mute">{t.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Groupings({ projectId, canEdit, loadItems, loadCategories }) {
  const toast = useToast()
  const [state, setState] = useState({ status: 'idle' })
  const [names, setNames] = useState({})
  async function look() {
    setState({ status: 'loading' })
    try {
      const result = await api.groupings(projectId)
      setState({ status: 'done', ...result })
      setNames(Object.fromEntries(result.groups.map((g, i) => [i, g.suggestedName || ''])))
    } catch (err) {
      setState({ status: 'error', message: err.message })
    }
  }
  async function accept(i) {
    const group = state.groups[i]
    const name = (names[i] || '').trim()
    if (!name) return toast('Give the thread a name first.', 'error')
    try {
      await api.createCategory(projectId, name, group.items.map((it) => it.id))
      await Promise.all([loadCategories(), loadItems()])
      setState((s) => ({ ...s, groups: s.groups.map((g, idx) => (idx === i ? { ...g, accepted: name } : g)) }))
      toast(`“${name}” is now a thread with ${group.items.length} references.`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  return (
    <section className="sheet p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-[1.35rem] mb-1">Sort the loose ones</h3>
          <p className="text-mute">Moodloom can look at the references that aren’t on a thread yet and suggest which ones go together. You name the groups and decide which to keep.</p>
        </div>
        {canEdit && (
          <button className="btn btn-plain" onClick={look} disabled={state.status === 'loading'}>
            <Layers size={16} /> {state.status === 'loading' ? 'Looking…' : state.status === 'done' ? 'Look again' : 'Suggest groups'}
          </button>
        )}
      </div>
      {state.status === 'error' && <div className="mt-4"><ErrorNote>{state.message}</ErrorNote></div>}
      {state.status === 'done' && state.groups.length === 0 && <p className="mt-4 bg-wall rounded-lg px-3 py-2 text-sm">{state.reason}</p>}
      {state.status === 'done' && state.groups.length > 0 && (
        <div className="mt-5 space-y-4">
          {state.groups.map((g, i) => (
            <div key={i} className="border border-line rounded-lg p-3">
              <div className="flex flex-wrap gap-1.5 mb-3">
                {g.items.slice(0, 14).map((it) => (
                  <Thumb key={it.id} item={it} projectId={projectId} />
                ))}
                {g.items.length > 14 && <span className="w-14 h-14 grid place-items-center text-sm text-mute">+{g.items.length - 14}</span>}
              </div>
              {g.accepted ? (
                <p className="text-sm text-moss font-medium">Now on the “{g.accepted}” thread.</p>
              ) : (
                <div className="flex gap-2">
                  <input className="field !py-1.5" placeholder="Name this group" maxLength={60} value={names[i] || ''} onChange={(e) => setNames((n) => ({ ...n, [i]: e.target.value }))} aria-label="Name for this group" />
                  <button className="btn btn-primary btn-sm !min-h-[38px]" onClick={() => accept(i)}>
                    Make it a thread
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DescribeSearch({ projectId }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState({ status: 'idle', items: [] })
  async function run(e) {
    e.preventDefault()
    if (q.trim().length < 2) return
    setState({ status: 'loading', items: [] })
    try {
      const r = await api.describeSearch(projectId, q.trim())
      setState({ status: r.available ? 'done' : 'unavailable', items: r.items })
    } catch (err) {
      setState({ status: 'error', message: err.message, items: [] })
    }
  }
  return (
    <section className="sheet p-5 sm:p-7">
      <h3 className="text-[1.35rem] mb-1">Find by describing</h3>
      <p className="text-mute mb-4 max-w-xl">Say what you’re looking for in plain words, and Moodloom ranks this board’s images by how well they match.</p>
      <form onSubmit={run} className="flex gap-2 max-w-xl">
        <input className="field" placeholder="warm serif packaging, grainy night photography…" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} aria-label="Describe what you’re looking for" />
        <button className="btn btn-plain" disabled={state.status === 'loading'}>
          <Search size={16} /> Find
        </button>
      </form>
      {state.status === 'loading' && <div className="mt-4"><Spinner /></div>}
      {state.status === 'unavailable' && <p className="mt-4 text-sm bg-wall rounded-lg px-3 py-2">The description model isn’t loaded on this server right now.</p>}
      {state.status === 'error' && <div className="mt-4"><ErrorNote>{state.message}</ErrorNote></div>}
      {state.status === 'done' && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {state.items.map((it) => (
            <Thumb key={it.id} item={it} projectId={projectId} size="w-20 h-20" />
          ))}
          {state.items.length === 0 && <p className="text-mute">Nothing on this board matches that.</p>}
        </div>
      )}
    </section>
  )
}

function noteAsText(note) {
  const c = note.content
  const list = (title, arr) => (arr?.length ? `\n${title}\n${arr.map((x) => `- ${x}`).join('\n')}\n` : '')
  return [
    c.statement,
    '',
    ...c.themes.map((t) => `${t.name}: ${t.description}`),
    c.palette?.notes ? `\nColour: ${c.palette.notes}${c.palette.colors?.length ? ` (${c.palette.colors.join(', ')})` : ''}` : '',
    c.typography ? `Type: ${c.typography}` : '',
    c.imagery ? `Imagery: ${c.imagery}` : '',
    c.tone_words?.length ? `Tone: ${c.tone_words.join(', ')}` : '',
    list('Stay away from', c.avoid),
    list('Tensions', c.tensions),
    list('Not covered yet', c.gaps),
    list('Next', c.next_steps),
  ]
    .filter((line) => line !== '')
    .join('\n')
}

const Block = ({ title, children }) => (
  <div>
    <h4 className="text-sm font-semibold mb-1" style={{ fontFamily: 'var(--font-sans)', letterSpacing: 0 }}>{title}</h4>
    {children}
  </div>
)
const Bullets = ({ items }) => (
  <ul className="list-disc pl-5 space-y-1">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
)

function DirectionNote({ note, itemsById, categories, projectId, canEdit, onDelete }) {
  const toast = useToast()
  const c = note.content
  const scope = note.category_id ? categories.find((x) => x.id === note.category_id)?.name : null
  return (
    <article className="sheet p-5 sm:p-7">
      <p className="display text-[clamp(1.25rem,2.4vw,1.7rem)] leading-snug max-w-3xl" style={{ fontWeight: 560 }}>
        {c.statement}
      </p>
      {c.tone_words?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {c.tone_words.map((w) => (
            <span key={w} className="chip chip-weld">{w}</span>
          ))}
        </div>
      )}

      <div className="mt-7 space-y-5">
        {c.themes.map((theme, i) => (
          <div key={i} className="grid md:grid-cols-[1fr_auto] gap-x-6 gap-y-2 border-t border-line pt-4">
            <div className="max-w-2xl">
              <h4 className="text-[1.1rem] mb-1">{theme.name}</h4>
              <p>{theme.description}</p>
              {!theme.grounded && <p className="text-sm text-madder mt-1">Not tied to a specific reference. Treat this one as a guess.</p>}
            </div>
            {theme.evidence.length > 0 && (
              <div className="flex gap-1.5 flex-wrap md:justify-end md:max-w-[15rem]" aria-label="References this is drawn from">
                {theme.evidence.map((id) => (
                  <Thumb key={id} item={itemsById.get(id)} projectId={projectId} size="w-12 h-12" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5 mt-7 border-t border-line pt-5">
        {(c.palette?.notes || c.palette?.colors?.length > 0) && (
          <Block title="Colour">
            {c.palette.colors?.length > 0 && (
              <div className="flex gap-1 mb-2 max-w-xs">
                {c.palette.colors.map((hex) => (
                  <Swatch key={hex} hex={hex} />
                ))}
              </div>
            )}
            <p>{c.palette.notes}</p>
          </Block>
        )}
        {c.typography && <Block title="Type"><p>{c.typography}</p></Block>}
        {c.imagery && <Block title="Imagery"><p>{c.imagery}</p></Block>}
        {c.avoid?.length > 0 && <Block title="Stay away from"><Bullets items={c.avoid} /></Block>}
        {c.tensions?.length > 0 && <Block title="Where the references disagree"><Bullets items={c.tensions} /></Block>}
        {c.gaps?.length > 0 && <Block title="Not on the wall yet"><Bullets items={c.gaps} /></Block>}
        {c.next_steps?.length > 0 && <Block title="Next"><Bullets items={c.next_steps} /></Block>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-4 border-t border-line text-sm text-mute">
        <span>
          A draft written by {note.model} from {note.source_item_ids.length} references{scope ? ` on “${scope}”` : ''}, {timeAgo(note.created_at)}. Check it against the wall before you rely on it.
        </span>
        <span className="flex gap-1">
          <button className="btn btn-quiet btn-sm" onClick={async () => (await copyText(noteAsText(note))) && toast('Copied as text.')}>
            <Copy size={14} /> Copy
          </button>
          {canEdit && (
            <button className="btn btn-quiet btn-sm" onClick={() => onDelete(note.id)}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </span>
      </footer>
    </article>
  )
}

export default function Direction({ project, projectId, items, categories, canEdit, isOwner, changeProject, loadItems, loadCategories }) {
  const toast = useToast()
  const status = useAsync(() => api.aiStatus(projectId), [projectId, project.ai_enabled])
  const notes = useAsync(() => api.directionNotes(projectId), [projectId])
  const [scope, setScope] = useState('')
  const [focus, setFocus] = useState('')
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState(null)
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const s = status.data

  // While references are still being analysed in the background, keep the count fresh.
  useEffect(() => {
    if (!s || s.counts.with_palette >= s.counts.total) return
    const t = setTimeout(() => status.reload(), 4000)
    return () => clearTimeout(t)
  }, [s, status])

  async function write(e) {
    e.preventDefault()
    setWriting(true)
    setError(null)
    try {
      const note = await api.writeDirection(projectId, { categoryId: scope || null, focus: focus.trim() || undefined })
      notes.setData((prev) => [note, ...(prev || [])])
      setFocus('')
    } catch (err) {
      setError(err.message)
    } finally {
      setWriting(false)
    }
  }
  async function remove(id) {
    if (!window.confirm('Delete this direction note?')) return
    try {
      await api.deleteDirection(projectId, id)
      notes.setData((prev) => prev.filter((n) => n.id !== id))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const available = s?.directionNotes.available
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <h2 className="text-[2rem] mb-1">Direction</h2>
          <p className="text-mute max-w-2xl">From a wall of references to a sentence you can design against. The reading comes first and happens on Moodloom’s own server; the written draft is optional and yours to switch on.</p>
        </div>

        <Digest projectId={projectId} categories={categories} />
        <Groupings projectId={projectId} canEdit={canEdit} loadItems={loadItems} loadCategories={loadCategories} />
        {s?.embedder.semantic && <DescribeSearch projectId={projectId} />}

        <section className="sheet p-5 sm:p-7">
          <h3 className="text-[1.35rem] mb-1">Draft a direction note</h3>
          <p className="text-mute max-w-2xl">
            Moodloom picks up to {status.data ? 10 : 'ten'} references that between them cover the range of the board, and asks a language model to say what they add up to against your brief. Every theme it
            writes has to point at the references it came from.
          </p>

          {status.loading && <div className="mt-4"><Spinner /></div>}
          {s && !available && (
            <p className="mt-4 bg-wall rounded-lg px-3.5 py-2.5 text-sm max-w-2xl">
              This needs an AI key on the server, and there isn’t one set. Everything above works without it. To turn this on, add <code>ANTHROPIC_API_KEY</code> to the backend’s <code>.env</code> and restart it.
            </p>
          )}
          {s && available && (
            <div className="mt-5 space-y-4">
              <div className="bg-wall rounded-lg px-3.5 py-3 max-w-2xl">
                <Toggle
                  checked={project.ai_enabled}
                  disabled={!isOwner}
                  onChange={(on) => changeProject({ aiEnabled: on })}
                  label={<span className="font-medium">Allow this project’s references to be sent to the AI provider</span>}
                />
                <p className="hint mt-2">
                  When you ask for a note, the chosen images (shrunk), their titles, your notes and tags, and the brief are sent to {s.directionNotes.provider === 'anthropic' ? 'Anthropic' : 'the configured provider'} to write
                  it. Nothing is sent at any other time. Leave this off for work under NDA.{!isOwner && ' Only the project owner can change this.'}
                </p>
              </div>
              {project.ai_enabled && canEdit && (
                <form onSubmit={write} className="flex flex-wrap gap-2 items-end max-w-2xl">
                  <label className="block">
                    <span className="label">Read</span>
                    <select className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
                      <option value="">The whole board</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block flex-1 min-w-52">
                    <span className="label">Anything to focus on? (optional)</span>
                    <input className="field" value={focus} maxLength={300} placeholder="The logo, the launch film, the packaging…" onChange={(e) => setFocus(e.target.value)} />
                  </label>
                  <button className="btn btn-primary" disabled={writing || items.length === 0}>
                    <Sparkles size={16} /> {writing ? 'Reading the wall…' : 'Draft a note'}
                  </button>
                </form>
              )}
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </section>

        {notes.data?.map((note) => (
          <DirectionNote key={note.id} note={note} itemsById={itemsById} categories={categories} projectId={projectId} canEdit={canEdit} onDelete={remove} />
        ))}
      </div>
    </div>
  )
}
