import { useCallback, useEffect, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { Circle, Eraser, Frame, Hand, Highlighter, ImagePlus, Minus, MousePointer2, MoveUpRight, PenLine, Pin, Plus, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react'
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
//   { id, type: 'rect' | 'ellipse' | 'arrow', x, y, w, h, color, size }   (w/h may be negative)
//   { id, type: 'frame', x, y, w, h, name }   an artboard to lay a screen out in

const INK = '#16201d'
const BASE_COLORS = [INK, '#c4472e', '#2f5fa8', '#5e8b3a', '#d9a300', '#b5578a']
const SIZES = [4, 8, 14]
const uid = () => Math.random().toString(36).slice(2, 10)
const TYPES = ['stroke', 'text', 'image', 'rect', 'ellipse', 'arrow', 'frame']
const SHAPES = ['rect', 'ellipse', 'arrow']
// Artboard sizes worth sketching into, in real pixels.
const FRAMES = [
  ['Phone', 390, 844],
  ['Desktop', 1440, 900],
  ['Square post', 1080, 1080],
  ['Story', 1080, 1920],
  ['A4', 595, 842],
]

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
  if (el.type === 'frame') return { x: el.x, y: el.y - 22, w: el.w, h: el.h + 22 }
  // shapes are drawn by dragging in any direction, so w/h can be negative
  const pad = SHAPES.includes(el.type) ? (el.size || 2) + 4 : 0
  return { x: Math.min(el.x, el.x + el.w) - pad, y: Math.min(el.y, el.y + el.h) - pad, w: Math.abs(el.w) + pad * 2, h: Math.abs(el.h) + pad * 2 }
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
  } else if (el.type === 'frame') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(el.x, el.y, el.w, el.h)
    ctx.strokeStyle = '#c9cec7'
    ctx.lineWidth = 1.5
    ctx.strokeRect(el.x, el.y, el.w, el.h)
    ctx.fillStyle = '#5c6762'
    ctx.font = '13px "Instrument Sans Variable", sans-serif'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(`${el.name}  ${el.w} × ${el.h}`, el.x, el.y - 7)
  } else if (SHAPES.includes(el.type)) {
    ctx.strokeStyle = el.color
    ctx.lineWidth = Math.max(1.5, el.size * 0.6)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (el.type === 'rect') ctx.roundRect(Math.min(el.x, el.x + el.w), Math.min(el.y, el.y + el.h), Math.abs(el.w), Math.abs(el.h), 4)
    else if (el.type === 'ellipse') ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2)
    else {
      const x2 = el.x + el.w
      const y2 = el.y + el.h
      const angle = Math.atan2(el.h, el.w)
      const head = Math.min(22, Math.hypot(el.w, el.h) * 0.35) + el.size
      ctx.moveTo(el.x, el.y)
      ctx.lineTo(x2, y2)
      ctx.moveTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45))
      ctx.lineTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45))
    }
    ctx.stroke()
  }
}

// Layer order: artboards at the back, then references, then everything drawn.
const layerOf = (el) => (el.type === 'frame' ? 0 : el.type === 'image' ? 1 : 2)
function drawAll(ctx, list, images) {
  for (let layer = 0; layer < 3; layer++) for (const el of list) if (layerOf(el) === layer) drawElement(ctx, el, images)
}
function moveBy(el, dx, dy) {
  if (el.type === 'stroke') return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p]) }
  return { ...el, x: el.x + dx, y: el.y + dy }
}

export default function Sketch({ projectId, items, canEdit, loadItems }) {
  const toast = useToast()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const elements = useRef([])
  const view = useRef({ x: 0, y: 0, zoom: 1 })
  const images = useRef(new Map())
  const drawing = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const saveTimer = useRef(null)
  const dirty = useRef(false)
  const raf = useRef(0)
  const selected = useRef(null)
  // Undo keeps whole snapshots, so it restores deletions and moves, not only the last stroke.
  const past = useRef([])
  const future = useRef([])
  const lastSnapshot = useRef([])
  const moving = useRef(null)
  const pendingText = useRef(null)
  const textRef = useRef(null)
  const textOpened = useRef(0)

  const [tool, setTool] = useState(canEdit ? 'pen' : 'hand')
  const [color, setColor] = useState(INK)
  const [size, setSize] = useState(SIZES[0])
  const [colors, setColors] = useState(BASE_COLORS)
  const [status, setStatus] = useState('loading')
  const [, bump] = useState(0)
  const [textAt, setTextAt] = useState(null)
  const [picking, setPicking] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [framePreset, setFramePreset] = useState(0)

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
      drawAll(ctx, elements.current, images.current)
      if (drawing.current) drawElement(ctx, drawing.current, images.current)
      const picked = selected.current && elements.current.find((el) => el.id === selected.current)
      if (picked) {
        const b = boundsOf(picked, ctx)
        ctx.strokeStyle = '#f0b90b'
        ctx.lineWidth = 2 / zoom
        ctx.setLineDash([7 / zoom, 5 / zoom])
        ctx.strokeRect(b.x - 4 / zoom, b.y - 4 / zoom, b.w + 8 / zoom, b.h + 8 / zoom)
        ctx.setLineDash([])
      }
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
        elements.current = (data.scene?.elements || []).filter((el) => TYPES.includes(el?.type))
        lastSnapshot.current = elements.current
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

  const changed = useCallback(
    (fromHistory = false) => {
      if (fromHistory !== true) {
        past.current.push(lastSnapshot.current)
        if (past.current.length > 100) past.current.shift()
        future.current = []
      }
      lastSnapshot.current = elements.current
      dirty.current = true
      setStatus('saving')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(save, 1200)
      bump((n) => n + 1)
      render()
    },
    [save, render]
  )

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
      // The box opens on release. Opening it on press let the press itself
      // steal focus back from it, which closed it before a key was typed.
      e.preventDefault()
      const rect = wrapRef.current.getBoundingClientRect()
      pendingText.current = { px, py, left: e.clientX - rect.left, top: e.clientY - rect.top, value: '' }
    } else if (SHAPES.includes(tool)) {
      drawing.current = { id: uid(), type: tool, x: px, y: py, w: 0, h: 0, color, size }
    } else if (tool === 'frame') {
      const [name, w, h] = FRAMES[framePreset]
      elements.current = [...elements.current, { id: uid(), type: 'frame', name, x: Math.round(px - w / 2), y: Math.round(py - h / 2), w, h }]
      changed()
    } else if (tool === 'select') {
      const ctx = canvasRef.current.getContext('2d')
      // topmost first: later layers, then later elements
      const hit = [...elements.current]
        .sort((a, b) => layerOf(b) - layerOf(a) || elements.current.indexOf(b) - elements.current.indexOf(a))
        .find((el) => {
          const b = boundsOf(el, ctx)
          return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
        })
      selected.current = hit?.id || null
      moving.current = hit ? { id: hit.id, sx: px, sy: py, original: hit, moved: false } : null
      bump((n) => n + 1)
      render()
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
    if (moving.current) {
      const m = moving.current
      m.moved = true
      const next = moveBy(m.original, px - m.sx, py - m.sy)
      elements.current = elements.current.map((el) => (el.id === m.id ? next : el))
      return render()
    }
    if (drawing.current && drawing.current.type !== 'stroke') {
      drawing.current.w = px - drawing.current.x
      drawing.current.h = py - drawing.current.y
      return render()
    }
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
    if (pendingText.current) {
      textOpened.current = Date.now()
      setTextAt(pendingText.current)
      pendingText.current = null
      return
    }
    if (moving.current) {
      const m = moving.current
      moving.current = null
      if (m.moved) {
          changed()
      }
      return
    }
    if (drawing.current && drawing.current.type !== 'stroke' && Math.hypot(drawing.current.w, drawing.current.h) < 6) {
      drawing.current = null // a click, not a drag: nothing to draw
      return render()
    }
    if (drawing.current) {
      const el = drawing.current
      drawing.current = null
      pathCache.delete(el)
      elements.current = [...elements.current, el]
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
    if (!past.current.length) return
    future.current.push(elements.current)
    elements.current = past.current.pop()
    selected.current = null
    changed(true)
  }, [changed])
  const redo = useCallback(() => {
    if (!future.current.length) return
    past.current.push(elements.current)
    elements.current = future.current.pop()
    changed(true)
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
        const map = { v: 'select', p: 'pen', m: 'marker', e: 'eraser', t: 'text', h: 'hand', r: 'rect', o: 'ellipse', a: 'arrow', f: 'frame' }
        if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()])
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected.current) {
          e.preventDefault()
          elements.current = elements.current.filter((el) => el.id !== selected.current)
          selected.current = null
              changed()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canEdit, undo, redo])

  // Focus the text box once it exists (after the click that opened it is over).
  useEffect(() => {
    if (!textAt) return
    const t = setTimeout(() => textRef.current?.focus(), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(textAt)])

  function commitText() {
    // Ignore a blur in the instant after opening; that is the opening click settling.
    if (Date.now() - textOpened.current < 250) {
      textRef.current?.focus()
      return
    }
    if (textAt?.value.trim()) {
      elements.current = [...elements.current, { id: uid(), type: 'text', x: textAt.px, y: textAt.py, text: textAt.value.trim().slice(0, 600), color, size: 14 + size * 2 }]
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
      drawAll(ctx, elements.current, images.current)
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
    ['select', MousePointer2, 'Select and move (V). Delete removes.'],
    ['pen', PenLine, 'Pen (P)'],
    ['marker', Highlighter, 'Marker (M)'],
    ['eraser', Eraser, 'Eraser (E)'],
    ['text', Type, 'Text (T)'],
    ['rect', Square, 'Rectangle (R)'],
    ['ellipse', Circle, 'Ellipse (O)'],
    ['arrow', MoveUpRight, 'Arrow (A)'],
    ['frame', Frame, 'Frame: an artboard to lay a screen out in (F)'],
    ['hand', Hand, 'Move the paper (H)'],
  ]
  const usable = items.filter((i) => i.thumbnail_url && (i.media_type === 'image' || i.media_type === 'link' || i.media_type === 'video'))
  const zoom = view.current.zoom
  const cursor = tool === 'hand' || !canEdit ? 'grab' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'

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
            <div className="sheet p-1 grid grid-cols-2 gap-0.5 pointer-events-auto" role="toolbar" aria-label="Drawing tools">
              {tools.map(([id, Icon, label]) => (
                <button key={id} title={label} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)} className={`w-9 h-9 rounded-md grid place-items-center ${tool === id ? 'bg-weld' : 'hover:bg-ink/7 text-mute hover:text-ink'}`}>
                  <Icon size={18} />
                </button>
              ))}
              <button title="Draw over a reference" aria-label="Draw over a reference" onClick={() => setPicking(true)} className="w-9 h-9 rounded-md grid place-items-center hover:bg-ink/7 text-mute hover:text-ink">
                <ImagePlus size={18} />
              </button>
            </div>
            {tool === 'frame' && (
              <div className="sheet p-1.5 pointer-events-auto text-sm" role="group" aria-label="Frame size">
                <p className="text-xs text-mute px-1 pb-1">Click the paper to place</p>
                {FRAMES.map(([name, w, h], i) => (
                  <button key={name} onClick={() => setFramePreset(i)} aria-pressed={framePreset === i} className={`block w-full text-left px-2 py-1 rounded-md ${framePreset === i ? 'bg-weld' : 'hover:bg-ink/7'}`}>
                    {name} <span className="text-xs opacity-70">{w}×{h}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="sheet p-1.5 grid grid-cols-2 justify-items-center gap-1.5 pointer-events-auto" role="group" aria-label="Pen colour and size">
              {colors.map((c) => (
                <button key={c} title={c.toUpperCase()} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`w-6 h-6 rounded-full border border-ink/15 ${color === c ? 'ring-2 ring-offset-2 ring-offset-paper ring-ink' : ''}`} style={{ background: c }} />
              ))}
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
              <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7 disabled:opacity-30" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl Z)" aria-label="Undo"><Undo2 size={16} /></button>
              <button className="w-8 h-8 rounded-md grid place-items-center hover:bg-ink/7 disabled:opacity-30" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl Shift Z)" aria-label="Redo"><Redo2 size={16} /></button>
              <button
                className="w-8 h-8 rounded-md grid place-items-center hover:bg-madder-soft hover:text-madder disabled:opacity-30"
                disabled={!elements.current.length}
                title="Clear the paper"
                aria-label="Clear the paper"
                onClick={() => {
                  if (!window.confirm('Clear the whole sketch? Undo brings it back until you leave the page.')) return
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
            ref={textRef}
            className="absolute bg-paper/95 border-2 border-weld rounded px-1.5 py-1 outline-none min-w-40 display"
            style={{ left: textAt.left, top: textAt.top, color, fontSize: (14 + size * 2) * zoom, lineHeight: 1.25 }}
            rows={2}
            value={textAt.value}
            maxLength={600}
            placeholder="Type, then press Enter"
            onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setTextAt(null)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                textOpened.current = 0
                commitText()
              }
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
