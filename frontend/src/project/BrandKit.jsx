import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, PencilLine, Pipette, Plus, Printer, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { ErrorNote, Modal, Spinner } from '../ui'
import { itemLabel } from '../lib/util'
import BrandKitView, { isKitEmpty } from './BrandKitView'

// The editor's working copy keeps empty rows so there's something to type
// into; this is what's actually saved and shown.
function clean(kit) {
  const text = (v) => (typeof v === 'string' ? v.trim() : v)
  const out = {}
  for (const key of ['name', 'tagline', 'story', 'audience']) if (text(kit[key])) out[key] = text(kit[key])
  const named = (list) => (list || []).map((v) => ({ name: text(v.name) || '', ...(text(v.description) ? { description: text(v.description) } : {}) })).filter((v) => v.name)
  const strings = (list) => (list || []).map(text).filter(Boolean)
  if (named(kit.values).length) out.values = named(kit.values)
  const voice = kit.voice || {}
  const v = {}
  if (text(voice.summary)) v.summary = text(voice.summary)
  if (named(voice.traits).length) v.traits = named(voice.traits)
  if (strings(voice.weSay).length) v.weSay = strings(voice.weSay)
  if (strings(voice.weDontSay).length) v.weDontSay = strings(voice.weDontSay)
  if (Object.keys(v).length) out.voice = v
  const logos = (kit.logos || []).filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, ...(text(l.label) ? { label: text(l.label) } : {}), ...(text(l.usage) ? { usage: text(l.usage) } : {}), ...(l.background ? { background: l.background } : {}) }))
  if (logos.length) out.logos = logos
  const lr = kit.logoRules || {}
  const rules = {}
  if (text(lr.clearSpace)) rules.clearSpace = text(lr.clearSpace)
  if (text(lr.minSize)) rules.minSize = text(lr.minSize)
  if (strings(lr.donts).length) rules.donts = strings(lr.donts)
  if (Object.keys(rules).length) out.logoRules = rules
  const colors = (kit.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex || '')).map((c) => ({ hex: c.hex.toLowerCase(), ...(text(c.name) ? { name: text(c.name) } : {}), ...(c.role ? { role: c.role } : {}), ...(text(c.meaning) ? { meaning: text(c.meaning) } : {}), ...(text(c.usage) ? { usage: text(c.usage) } : {}) }))
  if (colors.length) out.colors = colors
  const type = (kit.typography || []).filter((t) => text(t.family) || t.itemId).map((t) => ({ family: text(t.family) || '', ...(t.role ? { role: t.role } : {}), ...(t.itemId ? { itemId: t.itemId } : {}), ...(text(t.weights) ? { weights: text(t.weights) } : {}), ...(text(t.usage) ? { usage: text(t.usage) } : {}), ...(text(t.sample) ? { sample: text(t.sample) } : {}) }))
  if (type.length) out.typography = type
  for (const key of ['imagery', 'patterns']) {
    const s = kit[key] || {}
    const o = {}
    if (text(s.description)) o.description = text(s.description)
    if (s.itemIds?.length) o.itemIds = s.itemIds
    if (key === 'imagery' && text(s.avoid)) o.avoid = text(s.avoid)
    if (Object.keys(o).length) out[key] = o
  }
  const use = (kit.rules || []).filter((r) => text(r.text)).map((r) => ({ kind: r.kind === 'dont' ? 'dont' : 'do', text: text(r.text), ...(r.itemId ? { itemId: r.itemId } : {}) }))
  if (use.length) out.rules = use
  return out
}

function Card({ title, hint, children }) {
  return (
    <section className="sheet p-5 sm:p-6">
      <h3 className="text-[1.3rem]">{title}</h3>
      {hint && <p className="text-mute text-[0.95rem] mt-1 mb-4 max-w-2xl">{hint}</p>}
      <div className={hint ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

function StringList({ label, values, onChange, placeholder, max = 10 }) {
  const list = values || []
  return (
    <div>
      <span className="label">{label}</span>
      <div className="space-y-1.5">
        {list.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <input className="field !py-1.5" value={v} maxLength={200} placeholder={placeholder} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="btn btn-quiet btn-icon shrink-0" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove line"><X size={15} /></button>
          </div>
        ))}
        {list.length < max && (
          <button className="btn btn-quiet btn-sm" onClick={() => onChange([...list, ''])}><Plus size={14} /> Add a line</button>
        )}
      </div>
    </div>
  )
}

function NamedList({ values, onChange, namePlaceholder, descPlaceholder, max, addLabel }) {
  const list = values || []
  return (
    <div className="space-y-2">
      {list.map((v, i) => (
        <div key={i} className="grid sm:grid-cols-[12rem_1fr_auto] gap-1.5">
          <input className="field !py-1.5" value={v.name || ''} maxLength={60} placeholder={namePlaceholder} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="field !py-1.5" value={v.description || ''} maxLength={400} placeholder={descPlaceholder} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          <button className="btn btn-quiet btn-icon" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove"><X size={15} /></button>
        </div>
      ))}
      {list.length < max && <button className="btn btn-quiet btn-sm" onClick={() => onChange([...list, { name: '', description: '' }])}><Plus size={14} /> {addLabel}</button>}
    </div>
  )
}

function ItemPicker({ title, items, kinds, multiple, selected = [], max = 12, onClose, onPick }) {
  const [chosen, setChosen] = useState(selected)
  const usable = items.filter((i) => kinds.includes(i.media_type) && (i.media_type === 'font' || i.thumbnail_url))
  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={multiple ? <button className="btn btn-primary" onClick={() => onPick(chosen)}>Use {chosen.length} selected</button> : null}
    >
      {usable.length === 0 ? (
        <p className="text-mute">{kinds.includes('font') ? 'There are no font files on the board yet. Upload a .ttf, .otf or .woff2 to the board first.' : 'There are no images on the board yet.'}</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {usable.map((it) => {
            const on = chosen.includes(it.id)
            return (
              <button
                key={it.id}
                onClick={() => {
                  if (!multiple) return onPick([it.id])
                  setChosen(on ? chosen.filter((id) => id !== it.id) : chosen.length < max ? [...chosen, it.id] : chosen)
                }}
                aria-pressed={on}
                className={`aspect-square rounded overflow-hidden bg-wall grid place-items-center text-xs p-1 ${on ? 'ring-[3px] ring-weld' : 'hover:ring-2 ring-line'}`}
                title={itemLabel(it)}
              >
                {it.thumbnail_url ? <img src={it.thumbnail_url} alt={itemLabel(it)} loading="lazy" className="w-full h-full object-cover" /> : <span className="break-all">{itemLabel(it)}</span>}
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

function PickedItems({ ids, itemsById, onRemove }) {
  if (!ids?.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {ids.map((id) => {
        const it = itemsById.get(id)
        return (
          <span key={id} className="relative w-20 h-20 rounded overflow-hidden bg-wall">
            {it?.thumbnail_url && <img src={it.thumbnail_url} alt="" className="w-full h-full object-cover" />}
            <button className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-ink/75 text-white grid place-items-center" onClick={() => onRemove(id)} aria-label="Remove image"><X size={11} /></button>
          </span>
        )
      })}
    </div>
  )
}

// A brand guidelines document assembled from the project's own board:
// logos, colours and images are chosen from what's already been collected.
// Forms and layout only; nothing here is written by a model.
export default function BrandKit({ project, projectId, items, canEdit }) {
  const [kit, setKit] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState('edit')
  const [picker, setPicker] = useState(null)
  const timer = useRef(null)
  const latest = useRef(null)
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  useEffect(() => {
    let live = true
    api
      .brand(projectId)
      .then((res) => {
        if (!live) return
        latest.current = res.data || {}
        setKit(latest.current)
        if (!canEdit || !isKitEmpty(res.data)) setMode(canEdit ? 'edit' : 'view')
      })
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
      clearTimeout(timer.current)
    }
  }, [projectId, canEdit])

  function update(changes) {
    const next = { ...latest.current, ...changes }
    latest.current = next
    setKit(next)
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        await api.saveBrand(projectId, clean(next))
        setStatus('saved')
        setError(null)
      } catch (err) {
        setStatus('error')
        setError(err.message)
      }
    }, 800)
  }

  async function pullColours() {
    try {
      const digest = await api.digest(projectId)
      const have = new Set((latest.current.colors || []).map((c) => c.hex.toLowerCase()))
      const add = digest.palette.filter((c) => !have.has(c.hex.toLowerCase())).map((c) => ({ hex: c.hex, name: c.name }))
      if (!add.length) return setError(digest.palette.length ? 'The wall’s colours are already in the kit.' : 'There are no analysed images on the board to take colours from yet.')
      update({ colors: [...(latest.current.colors || []), ...add].slice(0, 16) })
    } catch (err) {
      setError(err.message)
    }
  }

  if (!kit) return <div className="h-full grid place-items-center">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>

  const voice = kit.voice || {}
  const logoRules = kit.logoRules || {}
  const setVoice = (c) => update({ voice: { ...voice, ...c } })
  const cleaned = clean(kit)

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6 no-print">
          <div>
            <h2 className="text-[2rem] mb-1">Brand kit</h2>
            <p className="text-mute max-w-xl">The decisions, written down where the client can see them. Logos, colours and images come from this project’s board.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mute" aria-live="polite">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : ''}</span>
            {canEdit && (
              <div className="flex rounded-lg border-[1.5px] border-line overflow-hidden bg-paper">
                <button className={`px-3 h-9 text-sm flex items-center gap-1.5 ${mode === 'edit' ? 'bg-spruce text-paper' : ''}`} onClick={() => setMode('edit')} aria-pressed={mode === 'edit'}><PencilLine size={15} /> Edit</button>
                <button className={`px-3 h-9 text-sm flex items-center gap-1.5 ${mode === 'view' ? 'bg-spruce text-paper' : ''}`} onClick={() => setMode('view')} aria-pressed={mode === 'view'}><Eye size={15} /> Preview</button>
              </div>
            )}
            {mode === 'view' && !isKitEmpty(cleaned) && (
              <button className="btn btn-plain" onClick={() => window.print()}><Printer size={16} /> Print or save PDF</button>
            )}
          </div>
        </div>
        <div className="mb-4 no-print"><ErrorNote>{error}</ErrorNote></div>

        {mode === 'view' ? (
          isKitEmpty(cleaned) ? (
            <p className="text-mute">Nothing has been written into this brand kit yet.</p>
          ) : (
            <div className="sheet p-6 sm:p-12"><BrandKitView kit={cleaned} itemsById={itemsById} fallbackName={project.name} /></div>
          )
        ) : (
          <div className="space-y-5">
            <Card title="The brand">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block"><span className="label">Name</span><input className="field" value={kit.name || ''} maxLength={120} placeholder={project.name} onChange={(e) => update({ name: e.target.value })} /></label>
                <label className="block"><span className="label">Line that sums it up</span><input className="field" value={kit.tagline || ''} maxLength={200} onChange={(e) => update({ tagline: e.target.value })} /></label>
                <label className="block"><span className="label">The story</span><textarea className="field !min-h-28" value={kit.story || ''} maxLength={3000} placeholder="Why it exists, in the plainest words you can find." onChange={(e) => update({ story: e.target.value })} /></label>
                <label className="block"><span className="label">Who it’s for</span><textarea className="field !min-h-28" value={kit.audience || ''} maxLength={2000} onChange={(e) => update({ audience: e.target.value })} /></label>
              </div>
              <div className="mt-5">
                <span className="label">What it stands for</span>
                <NamedList values={kit.values} onChange={(values) => update({ values })} namePlaceholder="A value" descPlaceholder="What that means in practice" max={8} addLabel="Add a value" />
              </div>
            </Card>

            <Card title="Voice" hint="How the brand talks. Real example lines do more than adjectives.">
              <label className="block mb-5"><span className="label">In a sentence or two</span><textarea className="field" value={voice.summary || ''} maxLength={1000} onChange={(e) => setVoice({ summary: e.target.value })} /></label>
              <span className="label">Traits</span>
              <NamedList values={voice.traits} onChange={(traits) => setVoice({ traits })} namePlaceholder="Plain-spoken" descPlaceholder="Short words. No jargon the customer wouldn’t use." max={6} addLabel="Add a trait" />
              <div className="grid sm:grid-cols-2 gap-5 mt-5">
                <StringList label="We say" values={voice.weSay} onChange={(weSay) => setVoice({ weSay })} placeholder="A line the brand would write" />
                <StringList label="We don’t say" values={voice.weDontSay} onChange={(weDontSay) => setVoice({ weDontSay })} placeholder="A line it never would" />
              </div>
            </Card>

            <Card title="Logo" hint="Upload the logo files to the board, then choose them here. Add one entry for each version: full colour, one colour, reversed, the mark alone.">
              <div className="space-y-3">
                {(kit.logos || []).map((logo, i) => {
                  const it = itemsById.get(logo.itemId)
                  const set = (c) => update({ logos: kit.logos.map((l, j) => (j === i ? { ...l, ...c } : l)) })
                  return (
                    <div key={i} className="grid sm:grid-cols-[7rem_1fr_auto] gap-3 items-start border border-line rounded-lg p-3">
                      <div className={`aspect-[3/2] rounded grid place-items-center p-2 ${logo.background ? '' : 'checker'}`} style={{ background: logo.background || undefined }}>
                        {it?.thumbnail_url && <img src={it.thumbnail_url} alt="" className="max-w-full max-h-full object-contain" />}
                      </div>
                      <div className="space-y-1.5">
                        <input className="field !py-1.5" value={logo.label || ''} maxLength={80} placeholder="Which version (Primary, Reversed, Mark only…)" onChange={(e) => set({ label: e.target.value })} />
                        <input className="field !py-1.5" value={logo.usage || ''} maxLength={400} placeholder="When to use it" onChange={(e) => set({ usage: e.target.value })} />
                        <label className="flex items-center gap-2 text-sm text-mute">
                          Shown on
                          <input type="color" value={logo.background || '#ffffff'} onChange={(e) => set({ background: e.target.value })} className="w-8 h-7 rounded border border-line bg-paper p-0.5" aria-label="Background colour" />
                          {logo.background && <button className="underline" onClick={() => set({ background: undefined })}>no background</button>}
                        </label>
                      </div>
                      <button className="btn btn-quiet btn-icon" onClick={() => update({ logos: kit.logos.filter((_, j) => j !== i) })} aria-label="Remove logo"><Trash2 size={15} /></button>
                    </div>
                  )
                })}
                {(kit.logos || []).length < 12 && (
                  <button className="btn btn-plain btn-sm" onClick={() => setPicker({ title: 'Choose a logo from the board', kinds: ['image'], multiple: false, onPick: ([id]) => update({ logos: [...(kit.logos || []), { itemId: id }] }) })}><Plus size={14} /> Add a logo from the board</button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-5">
                <label className="block"><span className="label">Clear space</span><input className="field" value={logoRules.clearSpace || ''} maxLength={400} placeholder="Keep the height of the “m” clear on every side" onChange={(e) => update({ logoRules: { ...logoRules, clearSpace: e.target.value } })} /></label>
                <label className="block"><span className="label">Smallest size</span><input className="field" value={logoRules.minSize || ''} maxLength={200} placeholder="24px on screen, 12mm in print" onChange={(e) => update({ logoRules: { ...logoRules, minSize: e.target.value } })} /></label>
              </div>
              <div className="mt-4"><StringList label="Never" values={logoRules.donts} onChange={(donts) => update({ logoRules: { ...logoRules, donts } })} placeholder="Stretch it, recolour it, put it on a busy photo…" /></div>
            </Card>

            <Card title="Colour" hint="Start from what the wall already agrees on, then say what each colour is for. A colour without a job gets misused.">
              <div className="space-y-2.5">
                {(kit.colors || []).map((c, i) => {
                  const set = (ch) => update({ colors: kit.colors.map((x, j) => (j === i ? { ...x, ...ch } : x)) })
                  return (
                    <div key={i} className="grid grid-cols-[3rem_1fr_auto] sm:grid-cols-[3rem_9rem_8rem_1fr_1fr_auto] gap-1.5 items-center">
                      <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#000000'} onChange={(e) => set({ hex: e.target.value })} className="w-12 h-[38px] rounded-lg border-[1.5px] border-line bg-paper p-0.5" aria-label="Colour" />
                      <input className="field !py-1.5" value={c.name || ''} maxLength={60} placeholder="Name" onChange={(e) => set({ name: e.target.value })} />
                      <select className="field !py-1.5 hidden sm:block" value={c.role || ''} onChange={(e) => set({ role: e.target.value || undefined })} aria-label="Role">
                        <option value="">Role</option>
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                        <option value="accent">Accent</option>
                        <option value="neutral">Neutral</option>
                      </select>
                      <input className="field !py-1.5 hidden sm:block" value={c.meaning || ''} maxLength={300} placeholder="What it stands for" onChange={(e) => set({ meaning: e.target.value })} />
                      <input className="field !py-1.5 hidden sm:block" value={c.usage || ''} maxLength={300} placeholder="Where it’s used" onChange={(e) => set({ usage: e.target.value })} />
                      <button className="btn btn-quiet btn-icon" onClick={() => update({ colors: kit.colors.filter((_, j) => j !== i) })} aria-label="Remove colour"><X size={15} /></button>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="btn btn-plain btn-sm" onClick={pullColours}><Pipette size={14} /> Take colours from the wall</button>
                {(kit.colors || []).length < 16 && <button className="btn btn-quiet btn-sm" onClick={() => update({ colors: [...(kit.colors || []), { hex: '#17332d' }] })}><Plus size={14} /> Add a colour</button>}
              </div>
            </Card>

            <Card title="Type" hint="Name each typeface and say what it’s for. If the font file is on the board, link it and the kit shows the real thing.">
              <div className="space-y-3">
                {(kit.typography || []).map((t, i) => {
                  const set = (ch) => update({ typography: kit.typography.map((x, j) => (j === i ? { ...x, ...ch } : x)) })
                  const font = t.itemId ? itemsById.get(t.itemId) : null
                  return (
                    <div key={i} className="border border-line rounded-lg p-3 grid sm:grid-cols-2 gap-1.5">
                      <input className="field !py-1.5" value={t.family || ''} maxLength={80} placeholder="Typeface name" onChange={(e) => set({ family: e.target.value })} />
                      <select className="field !py-1.5" value={t.role || ''} onChange={(e) => set({ role: e.target.value || undefined })} aria-label="Used for">
                        <option value="">Used for…</option>
                        <option value="display">Headlines</option>
                        <option value="body">Body text</option>
                        <option value="accent">Accent</option>
                      </select>
                      <input className="field !py-1.5" value={t.weights || ''} maxLength={120} placeholder="Weights (Regular, Semibold…)" onChange={(e) => set({ weights: e.target.value })} />
                      <input className="field !py-1.5" value={t.sample || ''} maxLength={200} placeholder="Sample text to show it with" onChange={(e) => set({ sample: e.target.value })} />
                      <input className="field !py-1.5 sm:col-span-2" value={t.usage || ''} maxLength={400} placeholder="Rules: sizes, tracking, where it never goes" onChange={(e) => set({ usage: e.target.value })} />
                      <div className="sm:col-span-2 flex items-center justify-between gap-2 text-sm">
                        <span className="text-mute truncate">{font ? `Font file: ${font.file_name || itemLabel(font)}` : 'No font file linked'}</span>
                        <span className="flex gap-1 shrink-0">
                          <button className="btn btn-quiet btn-sm" onClick={() => setPicker({ title: 'Choose a font file from the board', kinds: ['font'], multiple: false, onPick: ([id]) => set({ itemId: id, family: t.family || (itemsById.get(id)?.file_name || '').replace(/\.[a-z0-9]+$/i, '') }) })}>{font ? 'Change file' : 'Link a font file'}</button>
                          <button className="btn btn-quiet btn-sm" onClick={() => update({ typography: kit.typography.filter((_, j) => j !== i) })}><Trash2 size={14} /> Remove</button>
                        </span>
                      </div>
                    </div>
                  )
                })}
                {(kit.typography || []).length < 6 && <button className="btn btn-plain btn-sm" onClick={() => update({ typography: [...(kit.typography || []), { family: '' }] })}><Plus size={14} /> Add a typeface</button>}
              </div>
            </Card>

            {['imagery', 'patterns'].map((key) => {
              const s = kit[key] || {}
              const set = (ch) => update({ [key]: { ...s, ...ch } })
              return (
                <Card key={key} title={key === 'imagery' ? 'Imagery' : 'Pattern and texture'} hint={key === 'imagery' ? 'What photographs and illustrations for this brand look like, with examples from the board.' : 'Any repeating patterns, textures or graphic devices.'}>
                  <textarea className="field" value={s.description || ''} maxLength={key === 'imagery' ? 1500 : 1000} placeholder={key === 'imagery' ? 'Natural light, people mid-task, never posed…' : 'Where the pattern comes from and how big it runs'} onChange={(e) => set({ description: e.target.value })} aria-label="Description" />
                  <PickedItems ids={s.itemIds} itemsById={itemsById} onRemove={(id) => set({ itemIds: s.itemIds.filter((x) => x !== id) })} />
                  <button className="btn btn-plain btn-sm mt-3" onClick={() => setPicker({ title: 'Choose examples from the board', kinds: ['image', 'link', 'video'], multiple: true, selected: s.itemIds || [], onPick: (ids) => set({ itemIds: ids }) })}><Plus size={14} /> Choose examples from the board</button>
                  {key === 'imagery' && <label className="block mt-4"><span className="label">Avoid</span><input className="field" value={s.avoid || ''} maxLength={800} placeholder="Stock handshakes, heavy filters…" onChange={(e) => set({ avoid: e.target.value })} /></label>}
                </Card>
              )
            })}

            <Card title="Using it" hint="The do’s and don’ts someone needs when you’re not in the room.">
              <div className="space-y-1.5">
                {(kit.rules || []).map((r, i) => {
                  const set = (ch) => update({ rules: kit.rules.map((x, j) => (j === i ? { ...x, ...ch } : x)) })
                  return (
                    <div key={i} className="grid grid-cols-[6.5rem_1fr_auto] gap-1.5">
                      <select className="field !py-1.5" value={r.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Do or don’t">
                        <option value="do">Do</option>
                        <option value="dont">Don’t</option>
                      </select>
                      <input className="field !py-1.5" value={r.text || ''} maxLength={300} onChange={(e) => set({ text: e.target.value })} placeholder={r.kind === 'do' ? 'Give the logo room' : 'Put text over faces'} />
                      <button className="btn btn-quiet btn-icon" onClick={() => update({ rules: kit.rules.filter((_, j) => j !== i) })} aria-label="Remove rule"><X size={15} /></button>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn btn-plain btn-sm" onClick={() => update({ rules: [...(kit.rules || []), { kind: 'do', text: '' }] })}><Plus size={14} /> Add a do</button>
                <button className="btn btn-plain btn-sm" onClick={() => update({ rules: [...(kit.rules || []), { kind: 'dont', text: '' }] })}><Plus size={14} /> Add a don’t</button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {picker && (
        <ItemPicker
          {...picker}
          items={items}
          onClose={() => setPicker(null)}
          onPick={(ids) => {
            picker.onPick(ids)
            setPicker(null)
          }}
        />
      )}
    </div>
  )
}
