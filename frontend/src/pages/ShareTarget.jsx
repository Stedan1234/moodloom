import { useEffect, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Spinner, useAsync, Wordmark } from '../ui'

const LAST_KEY = 'moodloom_last_project'

// Where Android lands after "Share → Moodloom" from another app. The shared
// link arrives in the address; this screen asks which project it's for and
// saves it there. (Apps put the link in `url` or, often, inside `text`.)
export default function ShareTarget({ query }) {
  const title = query.get('title') || ''
  const text = query.get('text') || ''
  const link = query.get('url') || (text.match(/https?:\/\/\S+/) || [])[0] || ''
  const projects = useAsync(() => api.projects(), [])
  const [projectId, setProjectId] = useState('')
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState(link && text && !text.includes(link) ? text : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!projects.data) return
    const editable = projects.data.filter((p) => p.role !== 'viewer')
    let last = null
    try { last = localStorage.getItem(LAST_KEY) } catch { /* fine */ }
    setProjectId(String(editable.find((p) => String(p.id) === last)?.id || editable[0]?.id || 'new'))
  }, [projects.data])

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let pid = projectId
      if (pid === 'new') pid = String((await api.createProject(newName.trim() || 'Saved from my phone')).id)
      if (link) await api.capture(pid, { sourceUrl: link, title: title || undefined, note: note.trim() || undefined })
      else await api.addQuote(pid, { text: text || title, title: title && text ? title : undefined })
      try { localStorage.setItem(LAST_KEY, pid) } catch { /* fine */ }
      navigate(`/p/${pid}`, { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const editable = (projects.data || []).filter((p) => p.role !== 'viewer')
  return (
    <div className="min-h-screen p-5 max-w-md mx-auto">
      <Wordmark />
      <h1 className="text-3xl mt-8 mb-4">Save to a project</h1>
      {!link && !text && !title ? (
        <p className="text-mute">Nothing was shared. Use the share button in another app and pick Moodloom.</p>
      ) : (
        <form onSubmit={save} className="sheet p-5 space-y-4">
          <div className="bg-wall rounded-lg px-3 py-2 text-sm break-words">
            {title && <p className="font-semibold">{title}</p>}
            <p className="text-mute">{link || text}</p>
          </div>
          {projects.loading ? <Spinner /> : (
            <label className="block">
              <span className="label">Project</span>
              <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {editable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="new">A new project…</option>
              </select>
            </label>
          )}
          {projectId === 'new' && <input className="field" placeholder="Name the new project" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} aria-label="New project name" />}
          {link && (
            <label className="block">
              <span className="label">Why you’re saving it (optional)</span>
              <textarea className="field" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          <ErrorNote>{error || projects.error?.message}</ErrorNote>
          <button className="btn btn-primary w-full" disabled={busy || projects.loading}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      )}
    </div>
  )
}
