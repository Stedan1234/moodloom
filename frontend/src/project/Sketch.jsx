import { useCallback, useEffect, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { Eraser, Hand, Highlighter, ImagePlus, Minus, PenLine, Pin, Plus, Redo2, Trash2, Type, Undo2 } from 'lucide-react'
import { api } from '../api'
import { Modal, useToast } from '../ui'
import { itemLabel } from '../lib/util'

// A sketch pad for thinking with a pen, next to the references. Deliberately
// small: freehand strokes, a marker, text, and references pulled in to draw
// over. Finished design happens elsewhere; a sketch worth keeping gets
// pinned to the board as an image.
//
// The drawing is a list of plain elements in "paper" coordinates:
//   { id, type: 'stroke', tool, color, size, points: [[x, y, pressure], …] }
//   { id, type: 'text', x, y, text, color, size }
//   { id, type: 'image', x, y, w, h, itemId }

const INK = '#16201d'
const BASE_COLORS = [INK, '#c4472e', '#2f5fa8', '#5e8b3a', '#d9a300', '#b5578a']
const SIZES = [4, 8, 14]
const uid = () => Math.random().toString(36).slice(2, 10)

const pathCache = new WeakMap()
function strokePath(el) {
  let path = pathCache.get(el)
  if (path) return path
  const marker = el.tool === 'marker'
  const outline = getStroke(el.points, {
    size: marker ? el.size * 3.2 : el.size,
    thinning: marker ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: el.points.every((p) => p[2] === 0.5),
  })
  path = new Path2D()
  if (outline.length) {
    path.moveTo(outline[0][0], outline[0][1])
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i]
      const [x1, y1] = outline[(i + 1) % outline.length]
      path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
    }
    path.closePath()
  }
  pathCache.set(el, path)
  return path
}

function boundsOf(el, ctx) {
  if (el.type === 'stroke') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of el.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const pad = el.size * 2
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
  }
  if (el.type === 'text') {
    ctx.font = `${el.size}px "Bricolage Grotesque Variable", sans-serif`
    const lines = el.text.split('\n')
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width))
    return { x: el.x, y: el.y, w, h: lines.length * el.size * 1.25 }
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h }
}

function drawElement(ctx, el, images) {
  if (el.type === 'stroke') {
    ctx.globalAlpha = el.tool === 'marker' ? 0.38 : 1
    ctx.fillStyle = el.color
    ctx.fill(strokePath(el))
    ctx.globalAlpha = 1
  } else if (el.type === 'text') {
    ctx.fillStyle = el.color
    ctx.font = `${el.size}px "Bricolage Grotesque Variable", sans-serif`
    ctx.textBaseline = 'top'
    el.text.split('\n').forEach((line, i) => ctx.fillText(line, el.x, el.y + i * el.size * 1.25))
  } else if (el.type === 'image') {
    const img = images.get(el.itemId)
    if (img) ctx.drawImage(img, el.x, el.y, el.w, el.h)
    else {
      ctx.fillStyle = '#d9dcd6'
      ctx.fillRect(el.x, el.y, el.w, el.h)
    }
  }
}

export default function Sketch({ projectId, items, canEdit, loadItems }) {
  const toast = useToast()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const elements = useRef([])
  const undone = useRef([])
  const view = useRef({ x: 0, y: 0, zoom: 1 })
  const images = useRef(new Map())
  const drawing = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const saveTimer = useRef(null)
  const dirty = useRef(false)
  const raf = useRef(0)

  const [tool, setTool] = useState(canEdit ? 'pen' : 'hand')
  const [color, setColor] = useState(INK)
  const [size, setSize] = useState(SIZES[0])
  const [colors, setColors] = useState(BASE_COLORS)
  const [status, setStatus] = useState('loading')
  const [, bump] = useState(0)
  const [textAt, setTextAt] = useState(null)
  const [picking, setPicking] = useState(false)
  const [pinning, setPinning] = useState(false)

  const render = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const { x, y, zoom } = view.current
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#fcfcfa'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // dot grid, so the paper has a sense of scale
      const step = 28 * zoom
      if (step > 9) {
        ctx.fillStyle = '#cfd4cd'
        const ox = ((x * zoom) % step + step) % step
        const oy = ((y * zoom) % step + step) % step
        for (let gx = ox; gx < canvas.width / dpr; gx += step) for (let gy = oy; gy < canvas.height / dpr; gy += step) ctx.fillRect(gx * dpr, gy * dpr, 1.5 * dpr, 1.5 * dpr)
      }
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x * zoom, dpr * y * zoom)
      // references sit under the ink
      for (const el of elements.current) if (el.type === 'image') drawElement(ctx, el, images.current)
      for (const el of elements.current) if (el.type !== 'image') drawElement(ctx, el, images.current)
      if (drawing.current) drawElement(ctx, drawing.current, images.current)
    })
  }, [])

  const loadImage = useCallback(
    (itemId) => {
      if (images.current.has(itemId)) return
      const item = items.find((i) => i.id === itemId)
      const src = item?.is_upload && item.media_type === 'image' ? item.source_url : item?.thumbnail_url
      if (!src) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        images.current.set(itemId, img)
        render()
      }
      img.src = src
    },
    [items, render]
  )

  // load
  useEffect(() => {
    let live = true
    api
      .sketch(projectId)
      .then((data) => {
        if (!live) return
        elements.current = (data.scene?.elements || []).filter((el) => ['stroke', 'text', 'image'].includes(el?.type))
        setStatus('idle')
        bump((n) => n + 1)
        render()
      })
      .catch(() => live && setStatus('error'))
    return () => {
      live = false
    }
  }, [projectId, render])

  useEffect(() => {
    for (const el of elements.current) if (el.type === 'image') loadImage(el.itemId)
  })

  // The board's own colours are the first pens on offer.
  useEffect(() => {
    api
      .digest(projectId)
      .then((d) => {
        const fromBoard = (d.palette || []).map((c) => c.hex)
        if (fromBoard.length) setColors([INK, ...fromBoard.slice(0, 5), ...BASE_COLORS.slice(1)].filter((c, i, a) => a.indexOf(c) === i).slice(0, 9))
      })
      .catch(() => {})
  }, [projectId])

  // size the canvas to its box
  useEffect(() => {
    const wrap = wrapRef.current
    const resize = () => {
      const canvas = canvasRef.current
      if (!canvas || !wrap) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(wrap.clientWidth * dpr)
      canvas.height = Math.floor(wrap.clientHeight * dpr)
      render()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    document.fonts?.ready.then(render)
    return () => ro.disconnect()
  }, [render])

  const save = useCallback(async () => {
    if (!dirty.current) return
    dirty.current = false
    setStatus('saving')
    try {
      await api.saveSketch(projectId, { elements: elements.current, appState: { viewBackgroundColor: '#fcfcfa' }, files: {} })
      setStatus(dirty.current ? 'saving' : 'saved')
    } catch (err) {
      dirty.current = true
      setStatus('error')
      if (err.status === 413) toast(err.message, 'error')
    }
  }, [projectId, toast])

  const changed = useCallback(() => {
    dirty.current = true
    setStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1200)
    bump((n) => n + 1)
    render()
  }, [save, render])

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
      if (dirty.current) api.saveSketch(projectId, { elements: elements.current, appState: {}, files: {} }).catch(() => {})
    },
    [projectId]
  )

  const toPaper = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const { x, y, zoom } = view.current
    return [(e.clientX - rect.left) / zoom - x, (e.clientY - rect.top) / zoom - y]
  }

  function eraseAt(px, py) {
    const reach = 10 / view.current.zoom
    const ctx = canvasRef.current.getContext('2d')
    const before = elements.current.length
    elements.current = elements.current.filter((el) => {
      if (el.type === 'stroke') return !el.points.some(([x, y]) => Math.hypot(x - px, y - py) < reach + el.size)
      const b = boundsOf(el, ctx)
      return !(px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)
    })
    if (elements.current.length !== before) {
      undone.current = []
      changed()
    }
  }

  function onPointerDown(e) {
    canvasRef.current.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // two fingers: move and zoom the paper, whatever tool is selected
      drawing.current = null
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...view.current } }
      return
    }
    const [px, py] = toPaper(e)
    if (tool === 'hand' || e.button === 1 || !canEdit) {
      drawing.current = null
      pinch.current = { pan: true, sx: e.clientX, sy: e.clientY, view: { ...view.current } }
    } else if (tool === 'pen' || tool === 'marker') {
      drawing.current = { id: uid(), type: 'stroke', tool, color, size, points: [[px, py, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5]] }
    } else if (tool === 'eraser') {
      eraseAt(px, py)
    } else if (tool === 'text') {
      const rect = wrapRef.current.getBoundingClientRect()
      setTextAt({ px, py, left: e.clientX - rect.left, top: e.clientY - rect.top, value: '' })
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current?.pan) {
      const p = pinch.current
      view.current = { ...p.view, x: p.view.x + (e.clientX - p.sx) / p.view.zoom, y: p.view.y + (e.clientY - p.sy) / p.view.zoom }
      return render()
    }
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const p = pinch.current
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomTo(Math.min(4, Math.max(0.2, p.view.zoom * (dist / p.dist))), (a.x + b.x) / 2, (a.y + b.y) / 2, p)
      return
    }
    const [px, py] = toPaper(e)
    if (drawing.current) {
      const events = e.getCoalescedEvents?.() || [e]
      for (const ev of events.length ? events : [e]) {
        const [x, y] = toPaper(ev)
        drawing.current.points.push([x, y, ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5])
      }
      pathCache.delete(drawing.current)
      render()
    } else if (tool === 'eraser' && e.buttons) eraseAt(px, py)
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2 && pinch.current && !pinch.current.pan) pinch.current = null
    if (pinch.current?.pan) pinch.current = null
    if (drawing.current) {
      const el = drawing.current
      drawing.current = null
      pathCache.delete(el)
      elements.current = [...elements.current, el]
      undone.current = []
      changed()
    }
  }

  function zoomTo(zoom, clientX, clientY, from) {
    const rect = canvasRef.current.getBoundingClientRect()
    const base = from?.view || view.current
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    // keep the paper point under the pointer where it is
    const paperX = sx / base.zoom - base.x
    const paperY = sy / base.zoom - base.y
    view.current = { zoom, x: sx / zoom - paperX, y: sy / zoom - paperY }
    bump((n) => n + 1)
    render()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const onWheel = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomTo(Math.min(4, Math.max(0.2, view.current.zoom * Math.exp(-e.deltaY * 0.0022))), e.clientX, e.clientY)
      } else {
        view.current = { ...view.current, x: view.current.x - e.deltaX / view.current.zoom, y: view.current.y - e.deltaY / view.current.zoom }
        render()
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render])

  const undo = useCallback(() => {
    const last = elements.current[elements.current.length - 1]
    if (!last) return
    elements.current = elements.current.slice(0, -1)
    undone.current.push(last)
    changed()
  }, [changed])
  const redo = useCallback(() => {
    const el = undone.current.pop()
    if (!el) return
    elements.current = [...elements.current, el]
    changed()
  }, [changed])

  useEffect(() => {
    if (!canEdit) return
    const onKey = (e) => {
      const t = e.target
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (!e.metaKey && !e.ctrlKey) {
        const map = { p: 'pen', m: 'marker', e: 'eraser', t: 'text', h: 'hand' }
        if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canEdit, undo, redo])

  function commitText() {
    if (textAt?.value.trim()) {
      elements.current = [...elements.current, { id: uid(), type: 'text', x: textAt.px, y: textAt.py, text: textAt.value.trim().slice(0, 600), color, size: 14 + size * 2 }]
      undone.current = []
      changed()
    }
    setTextAt(null)
  }

  function placeReference(item) {
    setPicking(false)
    const src = item.is_upload ? item.source_url : item.thumbnail_url
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      images.current.set(item.id, img)
      const rect = wrapRef.current.getBoundingClientRect()
      const w = Math.min(360, img.naturalWidth)
      const h = w * (img.naturalHeight / img.naturalWidth)
      const { x, y, zoom } = view.current
      elements.current = [...elements.current, { id: uid(), type: 'image', itemId: item.id, x: rect.width / 2 / zoom - x - w / 2, y: rect.height / 2 / zoom - y - h / 2, w, h }]
      undone.current = []
      changed()
    }
    img.onerror = () => toast('That image’s site doesn’t let it be drawn on. Save a copy and upload it to the board to use it here.', 'error')
    img.src = src
  }

  async function pinToBoard() {
    if (!elements.current.length) return
    setPinning(true)
    try {
      const probe = canvasRef.current.getContext('2d')
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const el of elements.current) {
        const b = boundsOf(el, probe)
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.w)
        maxY = Math.max(maxY, b.y + b.h)
      }
      const pad = 32
      const scale = Math.min(2, 4000 / Math.max(maxX - minX + pad * 2, maxY - minY + pad * 2))
      const out = document.createElement('canvas')
      out.width = Math.ceil((maxX - minX + pad * 2) * scale)
      out.height = Math.ceil((maxY - minY + pad * 2) * scale)
      const ctx = out.getContext('2d')
      ctx.fillStyle = '#fcfcfa'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.setTransform(scale, 0, 0, scale, (pad - minX) * scale, (pad - minY) * scale)
      for (const el of elements.current) if (el.type === 'image') drawElement(ctx, el, images.current)
      for (const el of elements.current) if (el.type !== 'image') drawElement(ctx, el, images.current)
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('The sketch couldn’t be turned into an image.')
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await api.upload(projectId, new File([blob], `sketch ${stamp.replace(':', '.')}.png`, { type: 'image/png' }), { title: `Sketch, ${stamp}` })
      await loadItems()
      toast('Sketch pinned to the board.')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setPinning(false)
    }
  }

  const tools = [
    ['pen', PenLine, 'Pen (P)'],
    ['marker', Highlighter, 'Marker (M)'],
    ['eraser', Eraser, 'Eraser (E)'],
    ['text', Type, 'Text (T)'],
    ['hand', Hand, 'Move the paper (H)'],
  ]
  const usable = items.filter((i) => i.thumbnail_url && (i.media_type === 'image' || i.media_type === 'link' || i.media_type === 'video'))
  const zoom = view.current.zoom
  const cursor = tool === 'hand' || !canEdit ? 'grab' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div className="h-full flex flex-col">
      <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Sketch pad"
        />

        {status !== 'loading' && elements.current.length === 0 && !drawing.current && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none px-6">
            <div className="text-center max-w-sm">
              <p className="display text-2xl mb-1.5">Think with a pen</p>
              <p className="text-mute">{canEdit ? 'Thumbnails, layouts, a logo idea at 2am. Draw here, pull in a reference to sketch over, and pin anything worth keeping to the board.' : 'Nothing has been sketched here yet.'}</p>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="absolute left-3 top-3 bottom-3 flex flex-col gap-2 pointer-events-none">
            <div className="sheet p-1 flex flex-col gap-0.5 pointer-events-auto" role="toolbar" aria-label="Drawing tools">
              {tools.map(([id, Icon, label]) => (
                <button key={id} title={label} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)} className={`w-9 h-9 rounded-md grid place-items-center ${tool === id ? 'bg-weld' : 'hover:bg-ink/7 text-mute hover:text-ink'}`}>
                  <Icon size={18} />
                </button>
              ))}
              <span className="h-px bg-line my-1 mx-1" />
              <button title="Draw over a reference" aria-label="Draw over a reference" onClick={() => setPicking(true)} className="w-9 h-9 rounded-md grid place-items-center hover:bg-ink/7 text-mute hover:text-ink">
                <ImagePlus size={18} />
              </button>
            </div>
            <div className="sheet p-1.5 flex flex-col items-center gap-1.5 pointer-events-auto" role="group" aria-label="Pen colour and size">
              {colors.map((c) => (
                <button key={c} title={c.toUpperCase()} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`w-6 h-6 rounded-full border border-ink/15 ${color === c ? 'ring-2 ring-offset-2 ring-offset-paper ring-ink' : ''}`} style={{ background: c }} />
              ))}
              <span className="h-px bg-line w-full my-0.5" />
              {SIZES.map((s) => (
                <button key={s} title={`Pen width ${s}`} aria-label={`Pen width ${s}`} aria-pressed={size === s} onClick={() => setSize(s)} className={`w-7 h-7 rounded-md grid place-items-center ${size === s ? 'bg-ink/10' : 'hover:bg-ink/7'}`}>
                  <span className="rounded-full bg-ink" style={{ width: s + 3, height: s + 3 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <span className="text-xs text-mute mr-1" aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : ''}
          </span>
          {canEdit && (
            <div className="sheet p-1 flex gap-0.5">
              <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7 disabled:opacity-30" onClick={undo} disabled={!elements.current.length} title="Undo (Ctrl Z)" aria-label="Undo"><Undo2 size={16} /></button>
              <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7 disabled:opacity-30" onClick={redo} disabled={!undone.current.length} title="Redo (Ctrl Shift Z)" aria-label="Redo"><Redo2 size={16} /></button>
              <button
                className="w-8 h-8 rounded-md grid place-items-center hover:bg-madder-soft hover:text-madder disabled:opacity-30"
                disabled={!elements.current.length}
                title="Clear the paper"
                aria-label="Clear the paper"
                onClick={() => {
                  if (!window.confirm('Clear the whole sketch? You can undo this until you leave the page.')) return
                  undone.current = [...elements.current].reverse()
                  elements.current = []
                  changed()
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
          {canEdit && (
            <button className="btn btn-primary btn-sm !min-h-10" onClick={pinToBoard} disabled={pinning || !elements.current.length}>
              <Pin size={15} /> {pinning ? 'Pinning…' : 'Pin to board'}
            </button>
          )}
        </div>

        <div className="absolute right-3 bottom-3 sheet p-1 flex items-center gap-0.5">
          <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7" onClick={() => { const r = wrapRef.current.getBoundingClientRect(); zoomTo(Math.max(0.2, zoom / 1.25), r.left + r.width / 2, r.top + r.height / 2) }} aria-label="Zoom out"><Minus size={15} /></button>
          <button className="text-xs w-12 h-8 tabular-nums hover:bg-ink/7 rounded-md" onClick={() => { view.current = { x: 0, y: 0, zoom: 1 }; bump((n) => n + 1); render() }} title="Back to 100%">{Math.round(zoom * 100)}%</button>
          <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7" onClick={() => { const r = wrapRef.current.getBoundingClientRect(); zoomTo(Math.min(4, zoom * 1.25), r.left + r.width / 2, r.top + r.height / 2) }} aria-label="Zoom in"><Plus size={15} /></button>
        </div>

        {textAt && (
          <textarea
            autoFocus
            className="absolute bg-paper/95 border-2 border-weld rounded px-1.5 py-1 outline-none min-w-40 display"
            style={{ left: textAt.left, top: textAt.top, color, fontSize: (14 + size * 2) * zoom, lineHeight: 1.25 }}
            rows={2}
            value={textAt.value}
            maxLength={600}
            placeholder="Type, then click away"
            onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setTextAt(null)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitText()
            }}
          />
        )}
      </div>

      {picking && (
        <Modal title="Draw over a reference" onClose={() => setPicking(false)} wide>
          {usable.length === 0 ? (
            <p className="text-mute">There are no images on the board yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {usable.map((it) => (
                <button key={it.id} onClick={() => placeReference(it)} className="aspect-square rounded overflow-hidden bg-wall hover:ring-2 ring-weld" title={itemLabel(it)}>
                  <img src={it.thumbnail_url} alt={itemLabel(it)} loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
