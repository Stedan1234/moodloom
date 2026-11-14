// Small shared pieces of interface. Nothing here knows about projects.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { X, Check, Copy } from 'lucide-react'
import { copyText, inkOn } from './lib/util'

// The mark: three warp threads and one weld weft passing over, under, over.
export function Mark({ size = 26, dark = '#17332d', bright = '#f0b90b' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M2 16 C6 6, 10 6, 16 16 S 26 26, 30 16" fill="none" stroke={bright} strokeWidth="4.2" strokeLinecap="round" />
      <g stroke={dark} strokeWidth="4.2" strokeLinecap="round">
        <path d="M8 4v8.2M8 19.5V28" />
        <path d="M16 4v24" />
        <path d="M24 4v8.5M24 19.8V28" />
      </g>
      <path d="M12.6 10.4 C13.8 12, 14.8 13.8, 16 16 S 18.3 20, 19.5 21.6" fill="none" stroke={bright} strokeWidth="4.2" />
    </svg>
  )
}

export function Wordmark({ size = 26, light = false }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <Mark size={size} dark={light ? '#fcfcfa' : '#17332d'} />
      <span className="display" style={{ fontSize: size * 0.78, fontWeight: 700, color: light ? '#fcfcfa' : undefined }}>
        moodloom
      </span>
    </span>
  )
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span role="status" aria-label={label} className="inline-flex gap-1 items-center text-mute">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-current" style={{ animation: `fade .6s ${i * 0.15}s infinite alternate` }} />
      ))}
    </span>
  )
}

// ── toasts ──────────────────────────────────────────────────────────────
const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-2), { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex flex-col gap-2 items-center pointer-events-none no-print" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-rise pointer-events-auto px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg max-w-[90vw] ${
              t.kind === 'error' ? 'bg-madder text-white' : 'bg-spruce text-paper'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ── modal ───────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide = false, footer }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('input, textarea, select, button:not([data-close])')?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] bg-ink/45 flex items-end sm:items-center justify-center sm:p-6 anim-fade no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-paper w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-xl shadow-2xl anim-rise`}
      >
        <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
          <h2 className="text-xl">{title}</h2>
          <button data-close className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

// ── dropdown menu ───────────────────────────────────────────────────────
export function Menu({ button, children, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    const key = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={`absolute z-40 mt-1.5 min-w-48 bg-paper rounded-lg shadow-[var(--shadow-lift)] border border-line py-1 anim-rise ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon: Icon, children, danger, ...props }) {
  return (
    <button
      role="menuitem"
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ink/6 ${danger ? 'text-madder' : ''}`}
      {...props}
    >
      {Icon && <Icon size={16} className="shrink-0" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <span className="block text-sm text-madder mt-1">{error}</span> : hint ? <span className="block hint mt-1">{hint}</span> : null}
    </label>
  )
}

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm bg-madder-soft text-[#7a2413] rounded-lg px-3 py-2">
      {children}
    </p>
  )
}

// A colour you can click to copy.
export function Swatch({ hex, name, pct, size = 'md' }) {
  const [copied, setCopied] = useState(false)
  const h = size === 'lg' ? 'h-full min-h-16' : size === 'sm' ? 'h-7' : 'h-10'
  return (
    <button
      type="button"
      title={`Copy ${hex}`}
      onClick={async (e) => {
        e.stopPropagation()
        if (await copyText(hex.toUpperCase())) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }
      }}
      className={`group relative ${h} min-w-0 flex-1 rounded-md text-left overflow-hidden border border-ink/10`}
      style={{ background: hex, color: inkOn(hex), flexGrow: pct ? Math.max(pct, 6) : 1 }}
    >
      <span className="absolute inset-0 flex items-end justify-between gap-1 px-1.5 pb-1 text-[11px] font-semibold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
        <span className="truncate">{copied ? 'Copied' : hex.toUpperCase()}</span>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </span>
    </button>
  )
}

export function PaletteBar({ palette, size }) {
  if (!palette?.length) return null
  return (
    <div className="flex gap-1">
      {palette.map((c) => (
        <Swatch key={c.hex} {...c} size={size} />
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`flex items-center gap-2.5 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-spruce' : 'bg-line'}`}>
        <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-paper transition-transform ${checked ? 'translate-x-4' : ''}`} />
        <span className="absolute -inset-1 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-spruce" />
      </span>
      {label}
    </label>
  )
}

// useAsync(fn, deps): { data, error, loading, reload, setData }
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = useCallback(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => run(), [run])
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), [])
  return { ...state, reload: run, setData }
}
