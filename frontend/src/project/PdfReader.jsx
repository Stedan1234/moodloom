import { useEffect, useRef, useState } from 'react'
import { Quote } from 'lucide-react'
import { Spinner } from '../ui'

// Reads a PDF beside the work: pages are drawn to canvases with a selectable
// text layer over them, and a selected passage can be sent to the board as a
// quote card that remembers its source and page. Everything happens in the
// browser; the document is never sent anywhere.
export default function PdfReader({ url, canQuote, onQuote }) {
  const host = useRef(null)
  const [state, setState] = useState({ status: 'loading', pages: 0 })
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    let cancelled = false
    let doc = null
    const cleanups = []
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        doc = await pdfjs.getDocument({ url, isEvalSupported: false, enableXfa: false }).promise
        if (cancelled) return
        setState({ status: 'ready', pages: doc.numPages })
        const container = host.current
        const width = Math.min(container.clientWidth, 900)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        // Draw each page only when it scrolls near view: a 300-page
        // manuscript shouldn't cost 300 canvases up front.
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && !entry.target.dataset.drawn) {
                entry.target.dataset.drawn = '1'
                draw(entry.target, Number(entry.target.dataset.page))
              }
            }
          },
          { root: container.parentElement, rootMargin: '600px 0px' }
        )
        cleanups.push(() => observer.disconnect())

        async function draw(holder, pageNumber) {
          const page = await doc.getPage(pageNumber)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const scale = width / base.width
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          holder.style.height = ''
          holder.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise
          if (cancelled) return
          const layer = document.createElement('div')
          layer.className = 'textLayer'
          layer.style.setProperty('--scale-factor', String(scale))
          layer.style.setProperty('--total-scale-factor', String(scale))
          holder.appendChild(layer)
          const textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
          await textLayer.render().catch(() => {})
        }

        const first = await doc.getPage(1)
        const firstView = first.getViewport({ scale: 1 })
        const guessHeight = (width / firstView.width) * firstView.height
        for (let n = 1; n <= doc.numPages; n++) {
          const holder = document.createElement('div')
          holder.className = 'pdf-page'
          holder.dataset.page = String(n)
          holder.style.width = `${width}px`
          holder.style.maxWidth = '100%'
          holder.style.height = `${guessHeight}px`
          container.appendChild(holder)
          observer.observe(holder)
        }
      } catch {
        if (!cancelled) setState({ status: 'error', pages: 0 })
      }
    })()
    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
      doc?.destroy?.()
      if (host.current) host.current.replaceChildren()
    }
  }, [url])

  // Track the selected text and which page it starts on.
  useEffect(() => {
    if (!canQuote) return
    function onSelect() {
      const sel = window.getSelection()
      const text = sel?.toString().replace(/\s+/g, ' ').trim()
      if (!text || text.length < 3 || !host.current?.contains(sel.anchorNode)) return setSelection(null)
      const pageEl = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('.pdf-page')
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSelection({ text: text.slice(0, 4000), page: pageEl ? Number(pageEl.dataset.page) : null, top: rect.top, left: rect.left + rect.width / 2 })
    }
    document.addEventListener('selectionchange', onSelect)
    return () => document.removeEventListener('selectionchange', onSelect)
  }, [canQuote])

  return (
    <div className="relative w-full h-full overflow-y-auto scroll-thin px-2 py-4">
      {state.status === 'loading' && (
        <div className="grid place-items-center h-40 text-paper">
          <Spinner label="Opening the document" />
        </div>
      )}
      {state.status === 'error' && <p className="text-paper/80 text-center mt-10">This PDF couldn’t be opened here. Use “Open original” to view it in a new tab.</p>}
      <div ref={host} />
      {selection && (
        <button
          className="btn btn-weld btn-sm fixed z-[70] -translate-x-1/2 shadow-lg"
          style={{ top: Math.max(selection.top - 42, 8), left: selection.left }}
          // mousedown so the selection is still there when we read it
          onMouseDown={(e) => {
            e.preventDefault()
            onQuote({ text: selection.text, page: selection.page })
            window.getSelection()?.removeAllRanges()
            setSelection(null)
          }}
        >
          <Quote size={14} /> Pin this passage
        </button>
      )}
    </div>
  )
}
