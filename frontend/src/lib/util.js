// Thread colours, named after the dyes that made them. A category keeps its
// colour by its place in the list, so it stays the same everywhere it shows.
export const THREADS = [
  { name: 'weld', hex: '#d9a300' },
  { name: 'madder', hex: '#c4472e' },
  { name: 'woad', hex: '#2f5fa8' },
  { name: 'moss', hex: '#5e8b3a' },
  { name: 'cochineal', hex: '#b5578a' },
  { name: 'walnut', hex: '#7b5b3e' },
  { name: 'verdigris', hex: '#2e8c87' },
  { name: 'logwood', hex: '#6b5ba8' },
]
export const threadFor = (index) => THREADS[((index % THREADS.length) + THREADS.length) % THREADS.length].hex

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function timeAgo(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return days === 1 ? 'yesterday' : `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Black or white text on a given colour, whichever reads better.
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#16201d'
  const n = parseInt(m[1], 16)
  const lin = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.42 ? '#16201d' : '#ffffff'
}

// The player URL for an embedded video. Built here from an id the server
// extracted, so no HTML from anywhere is ever injected into the page.
export function embedUrl(item) {
  const { provider, videoId } = item.meta || {}
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return null
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
  if (provider === 'vimeo') return `https://player.vimeo.com/video/${videoId}`
  return null
}

// Only ever render http(s) links as clickable.
export function safeHref(url) {
  if (!url) return null
  if (url.startsWith('/uploads/')) return url
  try {
    const u = new URL(url, window.location.origin)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    el.remove()
    return ok
  }
}

export const KIND_LABEL = { image: 'Image', video: 'Video', link: 'Link', pdf: 'PDF', font: 'Font', file: 'File', quote: 'Passage' }

export function itemLabel(item) {
  return item.title || item.file_name || (item.media_type === 'quote' ? (item.note || '').slice(0, 60) : hostOf(item.source_url)) || KIND_LABEL[item.media_type]
}

export function debounce(fn, ms) {
  let t
  const wrapped = (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  wrapped.cancel = () => clearTimeout(t)
  return wrapped
}
