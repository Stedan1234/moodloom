import { useMemo, useState } from 'react'
import { FileUp } from 'lucide-react'
import { api } from '../api'
import { ErrorNote, Modal } from '../ui'

// Pulls links out of a browser's exported bookmarks file. Every browser
// writes the same old format: nested <DL> lists, <H3> for a folder and
// <A HREF> for a bookmark. Parsed with the browser's own HTML parser and
// read as text only; nothing from the file is ever inserted into the page.
function parseBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const folders = new Map()
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = a.getAttribute('href') || ''
    if (!/^https?:\/\//i.test(url)) continue
    const dl = a.closest('dl')
    const heading = dl?.previousElementSibling?.tagName === 'H3' ? dl.previousElementSibling : dl?.parentElement?.querySelector(':scope > h3')
    const folder = heading?.textContent?.trim() || 'Not in a folder'
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder).push({ url, title: (a.textContent || '').trim().slice(0, 300) || undefined })
  }
  return [...folders.entries()].map(([name, links]) => ({ name, links }))
}

const linksIn = (text) => [...new Set((text.match(/https?:\/\/[^\s<>"']+/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))].map((url) => ({ url }))

// Bring in many links at once: a pasted list, or a bookmarks export.
// Pinterest has no way to export a board, so the honest route for pins is
// to paste their links here (each one becomes a card with its preview) or
// to download the images and drop them on the board.
export default function ImportDialog({ projectId, categories, defaultCategory, onClose, onDone }) {
  const [text, setText] = useState('')
  const [folders, setFolders] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  const [categoryId, setCategoryId] = useState(defaultCategory ?? '')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const links = useMemo(() => {
    const fromFile = (folders || []).filter((f) => chosen.has(f.name)).flatMap((f) => f.links)
    const seen = new Set()
    return [...linksIn(text), ...fromFile].filter((l) => !seen.has(l.url) && seen.add(l.url))
  }, [text, folders, chosen])

  async function readFile(file) {
    setError(null)
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return setError('That file is larger than a bookmarks export should be.')
    const parsed = parseBookmarks(await file.text())
    if (!parsed.length) return setError('No links were found in that file. Export your bookmarks as an HTML file from your browser’s bookmark manager and choose that.')
    setFolders(parsed)
    setChosen(new Set())
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      let totals = { added: 0, alreadyOnBoard: 0, repeated: 0, invalid: 0, overLimit: 0 }
      for (let i = 0; i < links.length; i += 300) {
        const part = await api.importLinks(projectId, links.slice(i, i + 300), { categoryId: categoryId === '' ? null : Number(categoryId), tag: tag.trim() })
        totals = Object.fromEntries(Object.keys(totals).map((k) => [k, totals[k] + part[k]]))
      }
      setResult(totals)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const skipped = [
      result.alreadyOnBoard && `${result.alreadyOnBoard} already on the board`,
      result.invalid && `${result.invalid} weren’t web links`,
      result.overLimit && `${result.overLimit} over the board’s limit`,
    ].filter(Boolean)
    return (
      <Modal title="Imported" onClose={onClose}>
        <p className="mb-2">
          <strong>{result.added}</strong> {result.added === 1 ? 'link is' : 'links are'} on the board.{skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}
        </p>
        <p className="hint mb-4">Previews and colours fill in over the next minute or so as each page is fetched.</p>
        <button className="btn btn-primary w-full" onClick={onClose}>Done</button>
      </Modal>
    )
  }

  return (
    <Modal title="Import links" onClose={onClose} wide>
      <div className="space-y-4">
        <label className="block">
          <span className="label">Paste links</span>
          <textarea className="field !min-h-28 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="One per line, or any text with links in it: pins, posts, articles, videos" />
        </label>

        <div>
          <span className="label">Or a bookmarks file</span>
          <label className="btn btn-plain cursor-pointer">
            <FileUp size={16} /> Choose bookmarks.html
            <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          <p className="hint mt-1.5">In Chrome or Edge: Bookmarks manager → ⋮ → Export bookmarks. The file is read here in your browser; only the links you pick are sent.</p>
          {folders && (
            <div className="mt-3 border border-line rounded-xl max-h-52 overflow-y-auto scroll-thin divide-y divide-line">
              {folders.map((f) => (
                <label key={f.name} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-ink/4">
                  <input type="checkbox" checked={chosen.has(f.name)} onChange={(e) => setChosen((prev) => { const next = new Set(prev); if (e.target.checked) next.add(f.name); else next.delete(f.name); return next })} />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-mute">{f.links.length}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Put them on</span>
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No thread (loose)</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Tag them all (optional)</span>
            <input className="field" value={tag} maxLength={40} placeholder="imported" onChange={(e) => setTag(e.target.value)} />
          </label>
        </div>

        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary w-full" disabled={busy || links.length === 0} onClick={run}>
          {busy ? 'Importing…' : links.length ? `Import ${links.length} ${links.length === 1 ? 'link' : 'links'}` : 'Paste links or choose folders'}
        </button>
      </div>
    </Modal>
  )
}
