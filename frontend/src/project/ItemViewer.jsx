import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, SendHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { Spinner, Swatch, useToast } from '../ui'
import { embedUrl, formatBytes, hostOf, itemLabel, KIND_LABEL, safeHref, tagTint, threadFor, timeAgo } from '../lib/util'
import { useFontFace } from './ItemCard'

const PdfReader = lazy(() => import('./PdfReader'))

function FontSpecimen({ item }) {
  const family = useFontFace(item)
  const [sample, setSample] = useState('The quick brown fox jumps over the lazy dog')
  const style = { fontFamily: family ? `"${family}"` : 'inherit' }
  return (
    <div className="w-full max-w-3xl bg-paper rounded-md p-6 sm:p-10 overflow-y-auto max-h-full">
      {!family && <p className="hint mb-4">Loading the font…</p>}
      <input className="field mb-6" value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Sample text" />
      {[72, 44, 28, 18, 14].map((size) => (
        <p key={size} style={{ ...style, fontSize: size, lineHeight: 1.15 }} className="mb-4 break-words">
          {sample || 'Type something above'}
        </p>
      ))}
      <p style={{ ...style, fontSize: 22, lineHeight: 1.4 }} className="mt-6 break-words">
        ABCDEFGHIJKLMNOPQRSTUVWXYZ
        <br />
        abcdefghijklmnopqrstuvwxyz
        <br />
        0123456789 &amp; ! ? @ # £ $ % ( ) “ ” — …
      </p>
    </div>
  )
}

function Stage({ item, canEdit, onQuote }) {
  const kind = item.media_type
  const href = safeHref(item.source_url)
  if (kind === 'image') {
    const src = item.is_upload ? item.source_url : item.thumbnail_url || item.source_url
    const transparent = /png|svg|webp/.test(item.mime_type || '')
    return <img src={src} alt={item.title || ''} className={`max-w-full max-h-full object-contain rounded-sm ${transparent ? 'checker' : ''}`} />
  }
  if (kind === 'video') {
    const player = embedUrl(item)
    if (player) {
      return (
        <div className="w-full max-w-5xl aspect-video">
          <iframe
            src={player}
            title={item.title || 'Video'}
            className="w-full h-full rounded-sm"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      )
    }
    if (item.meta?.provider === 'file' && href) return <video src={href} controls playsInline className="max-w-full max-h-full rounded-sm bg-black" />
    return (
      <div className="text-center text-paper max-w-md">
        {item.thumbnail_url && <img src={item.thumbnail_url} alt="" className="max-h-[50vh] mx-auto rounded-sm mb-5" />}
        <p className="opacity-80 mb-4">This source doesn’t allow its videos to play inside other sites.</p>
        {href && (
          <a className="btn btn-weld" href={href} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} /> Open it on {hostOf(href)}
          </a>
        )}
      </div>
    )
  }
  if (kind === 'pdf' && href) {
    return (
      <Suspense fallback={<Spinner />}>
        <PdfReader url={href} canQuote={canEdit} onQuote={onQuote} />
      </Suspense>
    )
  }
  if (kind === 'font') return <FontSpecimen item={item} />
  if (kind === 'quote') {
    return (
      <div className="bg-paper rounded-md p-8 sm:p-12 max-w-2xl max-h-full overflow-y-auto">
        <p className="display text-[clamp(1.3rem,3vw,2rem)] leading-snug whitespace-pre-wrap break-words" style={{ fontWeight: 520 }}>
          {item.note}
        </p>
        {item.meta?.fromTitle && (
          <p className="text-mute mt-6">
            from {item.meta.fromTitle}
            {item.meta.page ? `, page ${item.meta.page}` : ''}
          </p>
        )}
      </div>
    )
  }
  if (kind === 'link') {
    return (
      <div className="text-center max-w-3xl">
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className="max-h-[62vh] max-w-full mx-auto rounded-sm mb-5" /> : <p className="display text-paper text-3xl mb-5 break-words">{item.title || hostOf(item.source_url)}</p>}
        {href && (
          <a className="btn btn-weld" href={href} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} /> Open {hostOf(href)}
          </a>
        )}
      </div>
    )
  }
  return (
    <div className="bg-paper rounded-md p-8 text-center max-w-sm">
      <FileText size={30} className="mx-auto mb-3 text-mute" />
      <p className="font-semibold break-words">{item.file_name}</p>
      <p className="hint mt-1 mb-5">{formatBytes(item.file_size)}. Moodloom holds this file; open it in the app that made it.</p>
      {href && (
        <a className="btn btn-primary" href={href} download={item.file_name || true}>
          <Download size={16} /> Download
        </a>
      )}
    </div>
  )
}

function TagEditor({ tags, canEdit, onChange }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const next = draft
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    if (next.length) onChange([...new Set([...tags, ...next])].slice(0, 20))
    setDraft('')
  }
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <span key={t} className="chip" style={tagTint(t)}>
          {t}
          {canEdit && (
            <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <input
          className="bg-transparent outline-none text-sm py-0.5 min-w-24 flex-1 placeholder:text-[#8b948f]"
          placeholder={tags.length ? 'Add another' : 'Add tags, comma separated'}
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
          }}
          onBlur={add}
          aria-label="Add a tag"
        />
      )}
      {!canEdit && tags.length === 0 && <span className="hint">No tags</span>}
    </div>
  )
}

// Remarks on one reference, for boards shared with other people. Anyone on
// the project can add one; you can remove your own, the owner any.
function Comments({ projectId, itemId, isOwner, onCount }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api.comments(projectId, itemId).then((c) => live && setList(c)).catch(() => live && setList([]))
    return () => {
      live = false
    }
  }, [projectId, itemId])
  async function send(e) {
    e.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      const created = await api.addComment(projectId, itemId, draft.trim())
      setList((prev) => [...(prev || []), created])
      onCount(1)
      setDraft('')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  async function remove(id) {
    try {
      await api.deleteComment(projectId, itemId, id)
      setList((prev) => prev.filter((c) => c.id !== id))
      onCount(-1)
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  return (
    <div>
      <span className="label">Comments{list?.length ? ` (${list.length})` : ''}</span>
      {list?.length > 0 && (
        <ul className="space-y-2.5 mb-3">
          {list.map((c) => (
            <li key={c.id} className="text-sm group/c">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold truncate">{c.mine ? 'You' : c.author}</span>
                <span className="text-xs text-mute shrink-0">
                  {timeAgo(c.created_at)}
                  {(c.mine || isOwner) && (
                    <button className="ml-2 underline opacity-0 group-hover/c:opacity-100 focus:opacity-100" onClick={() => remove(c.id)}>
                      remove
                    </button>
                  )}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="flex gap-1.5">
        <input className="field !py-1.5 text-sm" value={draft} maxLength={2000} placeholder={list?.length ? 'Reply' : 'Say something about this one'} onChange={(e) => setDraft(e.target.value)} aria-label="Write a comment" />
        <button className="btn btn-plain btn-icon shrink-0" disabled={busy || !draft.trim()} aria-label="Post comment" title="Post comment">
          <SendHorizontal size={15} />
        </button>
      </form>
    </div>
  )
}

export default function ItemViewer({ projectId, list, index, allItems, categories, canEdit, isOwner = false, readOnlyShare = false, onCommentCount = () => {}, onGo, onClose, onChanged, onDelete, onAdded }) {
  const toast = useToast()
  const item = list[index]
  const [title, setTitle] = useState(item.title || '')
  const [note, setNote] = useState(item.note || '')
  const [similar, setSimilar] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  const panel = useRef(null)
  const hasPrev = index > 0
  const hasNext = index < list.length - 1
  const isQuote = item.media_type === 'quote'

  useEffect(() => {
    const typing = (t) => t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable
    function onKey(e) {
      if (e.key === 'Escape') {
        if (typing(e.target)) return e.target.blur()
        onClose()
      } else if (!typing(e.target)) {
        if (e.key === 'ArrowLeft' && hasPrev) onGo(list[index - 1].id)
        if (e.key === 'ArrowRight' && hasNext) onGo(list[index + 1].id)
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, hasPrev, hasNext, list, onGo, onClose])

  // What else on this wall looks like it, and where it might belong.
  useEffect(() => {
    // A shared page has no account behind it, so nothing to ask the server.
    if (readOnlyShare) return
    let live = true
    api.similar(projectId, item.id).then((r) => live && setSimilar(r)).catch(() => live && setSimilar({ available: false, items: [] }))
    if (item.category_id === null && categories.length && canEdit) {
      api.suggestCategory(projectId, item.id).then((r) => live && setSuggestion(r.suggestion)).catch(() => {})
    }
    return () => {
      live = false
    }
  }, [projectId, item.id, item.category_id, categories.length, canEdit, readOnlyShare])

  async function save(changes) {
    try {
      onChanged(await api.updateItem(projectId, item.id, changes))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function pinPassage({ text, page }) {
    try {
      await api.addQuote(projectId, { text, fromItemId: item.id, page: page || undefined, categoryId: item.category_id })
      toast(page ? `Passage from page ${page} pinned to the board.` : 'Passage pinned to the board.')
      onAdded()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const href = safeHref(item.source_url)
  const foundOn = safeHref(item.meta?.foundOn)
  const categoryIndex = categories.findIndex((c) => c.id === item.category_id)
  const suggested = suggestion && categories.find((c) => c.id === suggestion.categoryId)

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-[#101714] anim-fade" role="dialog" aria-modal="true" aria-label={itemLabel(item)}>
      <div className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center p-3 sm:p-8 basis-[52%] md:basis-auto" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <Stage item={item} canEdit={canEdit} onQuote={pinPassage} />
        {hasPrev && (
          <button className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-paper/15 hover:bg-paper/30 text-paper grid place-items-center" onClick={() => onGo(list[index - 1].id)} aria-label="Previous reference" title="Previous (←)">
            <ChevronLeft size={22} />
          </button>
        )}
        {hasNext && (
          <button className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-paper/15 hover:bg-paper/30 text-paper grid place-items-center" onClick={() => onGo(list[index + 1].id)} aria-label="Next reference" title="Next (→)">
            <ChevronRight size={22} />
          </button>
        )}
        {list.length > 1 && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-paper/70 text-xs bg-black/40 rounded-full px-2.5 py-0.5">
            {index + 1} of {list.length}
          </span>
        )}
      </div>

      <aside ref={panel} className="md:w-[360px] xl:w-[400px] shrink-0 bg-paper flex flex-col min-h-0 basis-[48%] md:basis-auto rounded-t-2xl md:rounded-none">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-sm text-mute">
            {KIND_LABEL[item.media_type]}
            {!item.is_upload && !isQuote && href ? `, ${hostOf(href)}` : ''}
          </span>
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={19} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-4 pb-5 space-y-5">
          <div>
            <input
              className="w-full bg-transparent display text-[1.35rem] leading-tight outline-none border-b-2 border-transparent focus:border-weld placeholder:text-[#9aa29c] pb-0.5"
              value={title}
              placeholder={isQuote ? 'Where it’s from' : 'Give it a title'}
              readOnly={!canEdit}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() !== (item.title || '') && save({ title: title.trim() || null })}
              aria-label="Title"
            />
          </div>

          <div>
            <label className="label" htmlFor="item-note">
              {isQuote ? 'Passage' : 'Why it’s here'}
            </label>
            <textarea
              id="item-note"
              className="field !min-h-24 text-[0.95rem]"
              value={note}
              readOnly={!canEdit}
              maxLength={5000}
              placeholder={canEdit ? 'The colour? The way the type sits? Say it now, while you remember.' : ''}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note.trim() !== (item.note || '') && (isQuote && !note.trim() ? setNote(item.note || '') : save({ note: note.trim() || null }))}
            />
          </div>

          <div>
            <span className="label">Tags</span>
            <TagEditor tags={item.tags || []} canEdit={canEdit} onChange={(tags) => save({ tags })} />
          </div>

          {item.palette?.length > 0 && (
            <div>
              <span className="label">Colours in it</span>
              <div className="space-y-1">
                {item.palette.map((c) => (
                  <div key={c.hex} className="flex items-center gap-2.5 text-sm">
                    <span className="w-16 flex"><Swatch hex={c.hex} size="sm" /></span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-mute tabular-nums">{c.hex.toUpperCase()}</span>
                    <span className="text-mute tabular-nums w-10 text-right">{Math.round(c.pct)}%</span>
                  </div>
                ))}
              </div>
              {item.meta?.traits?.length > 0 && <p className="hint mt-2">Reads as {item.meta.traits.join(', ')}.</p>}
            </div>
          )}

          <div>
            <label className="label" htmlFor="item-category">
              Thread
            </label>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: categoryIndex >= 0 ? threadFor(categoryIndex) : '#9aa29c' }} />
              <select
                id="item-category"
                className="field !py-1.5"
                value={item.category_id ?? ''}
                disabled={!canEdit}
                onChange={(e) => save({ categoryId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Loose (no thread)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {suggested && item.category_id === null && (
              <button className="mt-2 text-sm flex items-center gap-1.5 bg-weld-soft rounded-lg px-2.5 py-1.5 text-left" onClick={() => save({ categoryId: suggested.id })}>
                <Sparkles size={14} className="shrink-0" />
                <span>
                  Looks most like what’s on <strong>{suggested.name}</strong>. Move it there
                </span>
              </button>
            )}
          </div>

          {similar?.items?.length > 0 && (
            <div>
              <span className="label">More like this, on this wall</span>
              <div className="grid grid-cols-4 gap-1.5">
                {similar.items.slice(0, 8).map((s) => (
                  <button key={s.id} onClick={() => onGo(s.id)} className="aspect-square rounded overflow-hidden bg-wall hover:ring-2 ring-weld" title={`${itemLabel(s)} (${Math.round(s.similarity * 100)}% alike)`} style={{ background: s.palette?.[0]?.hex }}>
                    {s.thumbnail_url && <img src={s.thumbnail_url} alt={itemLabel(s)} className="w-full h-full object-cover" loading="lazy" />}
                  </button>
                ))}
              </div>
              <p className="hint mt-1.5">Matched by colour, layout and texture, worked out on Moodloom’s own server.</p>
            </div>
          )}

          {!readOnlyShare && <Comments projectId={projectId} itemId={item.id} isOwner={isOwner} onCount={(d) => onCommentCount(item.id, d)} />}

          <div className="text-sm text-mute space-y-1 pt-1">
            {item.file_name && <p className="break-all">{item.file_name}{item.file_size ? `, ${formatBytes(item.file_size)}` : ''}</p>}
            {item.width && item.height && <p>{item.width} × {item.height} px</p>}
            {foundOn && (
              <p className="truncate">
                Found on <a className="underline" href={foundOn} target="_blank" rel="noreferrer noopener">{hostOf(foundOn)}</a>
              </p>
            )}
            <p>Added {timeAgo(item.created_at)}</p>
          </div>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-line">
          {href && !isQuote && (
            <a className="btn btn-plain btn-sm flex-1" href={href} target="_blank" rel="noreferrer noopener" {...(item.is_upload ? { download: item.file_name || true } : {})}>
              {item.is_upload ? <Download size={15} /> : <ExternalLink size={15} />}
              {item.is_upload ? 'Download' : 'Open original'}
            </a>
          )}
          {canEdit && (
            <button className="btn btn-quiet btn-sm text-madder hover:!bg-madder-soft hover:!text-madder" onClick={() => onDelete(item.id)}>
              <Trash2 size={15} /> Remove
            </button>
          )}
        </div>
      </aside>
      <span className="sr-only" aria-live="polite">{allItems.length} references on the board</span>
    </div>
  )
}
