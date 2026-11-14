import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, MessageSquareText, Play, Quote, Trash2 } from 'lucide-react'
import { embedUrl, formatBytes, hostOf, itemLabel, safeHref } from '../lib/util'

// Loads an uploaded font file under a private family name so it can be shown
// as a specimen. Returns the CSS family, or null until it's ready.
export function useFontFace(item) {
  const [family, setFamily] = useState(null)
  useEffect(() => {
    if (item.media_type !== 'font' || !item.source_url || typeof FontFace === 'undefined') return
    const name = `ml-font-${item.id}`
    let live = true
    const face = new FontFace(name, `url(${JSON.stringify(item.source_url)})`)
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded)
        if (live) setFamily(name)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [item.id, item.media_type, item.source_url])
  return family
}


function ratio(item, fallback) {
  return item.width && item.height ? `${item.width} / ${item.height}` : fallback
}

function Picture({ item, fallback = '4 / 3' }) {
  const [failed, setFailed] = useState(false)
  if (failed || !item.thumbnail_url) return null
  const transparent = item.mime_type === 'image/png' || item.mime_type === 'image/svg+xml' || item.mime_type === 'image/webp'
  return (
    <div className={transparent ? 'checker' : ''} style={{ aspectRatio: ratio(item, fallback), background: transparent ? undefined : item.palette?.[0]?.hex || '#d9dcd6' }}>
      <img src={item.thumbnail_url} alt={item.title || ''} loading="lazy" className="w-full h-full object-cover block" onError={() => setFailed(true)} />
    </div>
  )
}

function Body({ item, fontFamily }) {
  const kind = item.media_type
  if (kind === 'image') {
    return <Picture item={item} />
  }
  if (kind === 'video') {
    const playable = embedUrl(item) || item.meta?.provider === 'file'
    return (
      <div className="relative">
        {item.thumbnail_url ? (
          <Picture item={item} fallback="16 / 9" />
        ) : item.meta?.provider === 'file' && item.source_url ? (
          <video src={`${item.source_url}#t=0.1`} preload="metadata" muted playsInline className="w-full block bg-ink" style={{ aspectRatio: ratio(item, '16 / 9') }} />
        ) : (
          <div className="aspect-video bg-spruce" />
        )}
        <span className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="w-11 h-11 rounded-full bg-paper/92 grid place-items-center shadow">
            {playable ? <Play size={17} fill="#16201d" className="ml-0.5" /> : <ExternalLink size={16} />}
          </span>
        </span>
      </div>
    )
  }
  if (kind === 'link') {
    if (item.thumbnail_url) return <Picture item={item} fallback="1.91 / 1" />
    return (
      <div className="p-4 pb-2">
        <ExternalLink size={15} className="text-mute mb-2" />
        <p className="display text-[1.05rem] leading-snug break-words">{item.title || hostOf(item.source_url)}</p>
      </div>
    )
  }
  if (kind === 'quote') {
    return (
      <div className="p-4 pb-2">
        <Quote size={15} className="text-weld mb-2" fill="currentColor" />
        <p className="display text-[1.02rem] leading-snug whitespace-pre-wrap break-words" style={{ fontWeight: 520 }}>
          {(item.note || '').length > 420 ? `${item.note.slice(0, 420)}…` : item.note}
        </p>
      </div>
    )
  }
  if (kind === 'font') {
    return (
      <div className="p-4 pb-2">
        <div className="text-[3.4rem] leading-none truncate" style={{ fontFamily: fontFamily ? `"${fontFamily}"` : 'inherit', opacity: fontFamily ? 1 : 0.25 }}>
          Ag
        </div>
        <div className="text-[1.05rem] mt-2 leading-tight truncate" style={{ fontFamily: fontFamily ? `"${fontFamily}"` : 'inherit' }}>
          Hamburgefonstiv 0123
        </div>
      </div>
    )
  }
  if (kind === 'pdf') {
    if (item.thumbnail_url) return <Picture item={item} fallback="1 / 1.414" />
    return (
      <div className="p-4 pb-2 flex gap-3 items-start">
        <span className="w-10 h-12 rounded-sm bg-madder-soft text-madder grid place-items-center shrink-0">
          <FileText size={18} />
        </span>
        <p className="font-medium leading-snug break-words min-w-0">{item.title || item.file_name}</p>
      </div>
    )
  }
  // A held file: stored and downloadable, not previewed.
  const ext = (item.file_name || '').split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'
  return (
    <div className="p-4 pb-2 flex gap-3 items-start">
      <span className="min-w-10 h-12 px-1.5 rounded-sm bg-wall text-[11px] font-bold grid place-items-center shrink-0">{ext}</span>
      <p className="font-medium leading-snug break-words min-w-0">{item.title || item.file_name}</p>
    </div>
  )
}

function caption(item) {
  const kind = item.media_type
  if (kind === 'quote') return item.meta?.fromTitle ? `from ${item.meta.fromTitle}${item.meta.page ? `, p. ${item.meta.page}` : ''}` : item.title || null
  if (kind === 'font') return item.title || item.file_name
  if (kind === 'file' || (kind === 'pdf' && !item.thumbnail_url)) return formatBytes(item.file_size)
  if (kind === 'link' && !item.thumbnail_url) return hostOf(item.source_url)
  return item.title || (item.is_upload ? item.file_name : hostOf(item.source_url))
}

export default function ItemCard({ item, thread, canEdit, onOpen, onDelete, dragProps, dimmed }) {
  const fontFamily = useFontFace(item)
  const text = caption(item)
  const hasNote = item.media_type !== 'quote' && item.note
  return (
    <article
      className={`pin relative mb-4 break-inside-avoid group ${dimmed ? 'opacity-35' : ''}`}
      style={thread ? { borderTop: `3px solid ${thread}` } : undefined}
      {...dragProps}
    >
      <button type="button" className="block w-full text-left cursor-zoom-in" onClick={() => onOpen(item.id)} aria-label={`Open ${itemLabel(item)}`}>
        <Body item={item} fontFamily={fontFamily} />
        {item.palette?.length > 0 && (item.media_type === 'image' || item.thumbnail_url) && (
          <span className="flex h-1.5" aria-hidden="true">
            {item.palette.map((c) => (
              <span key={c.hex} style={{ background: c.hex, flexGrow: Math.max(c.pct, 4) }} />
            ))}
          </span>
        )}
        {(text || hasNote || item.tags?.length > 0) && (
          <span className="block px-3 py-2">
            {text && <span className="block text-[13px] text-mute truncate">{text}</span>}
            {hasNote && (
              <span className="flex gap-1.5 text-[13px] mt-1 leading-snug">
                <MessageSquareText size={13} className="shrink-0 mt-0.5 text-weld" />
                <span className="line-clamp-2">{item.note}</span>
              </span>
            )}
            {item.tags?.length > 0 && (
              <span className="flex flex-wrap gap-1 mt-1.5">
                {item.tags.slice(0, 4).map((t) => (
                  <span key={t} className="chip !text-[11px]">
                    {t}
                  </span>
                ))}
                {item.tags.length > 4 && <span className="chip !text-[11px]">+{item.tags.length - 4}</span>}
              </span>
            )}
          </span>
        )}
      </button>
      <div className="pin-tools absolute top-1.5 right-1.5 flex gap-1">
        {item.media_type === 'file' && safeHref(item.source_url) && (
          <a href={safeHref(item.source_url)} download={item.file_name || true} className="w-7 h-7 rounded-full bg-ink/75 text-white grid place-items-center" title="Download" aria-label="Download file">
            <Download size={14} />
          </a>
        )}
        {canEdit && (
          <button className="w-7 h-7 rounded-full bg-ink/75 text-white grid place-items-center hover:bg-madder" onClick={() => onDelete(item.id)} title="Remove from board" aria-label={`Remove ${itemLabel(item)}`}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </article>
  )
}
