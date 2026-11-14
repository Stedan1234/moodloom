import { useState } from 'react'
import { Copy, Link2, Trash2, UserPlus } from 'lucide-react'
import { api } from '../api'
import { ErrorNote, Modal, Spinner, Toggle, useAsync, useToast } from '../ui'
import { copyText, timeAgo } from '../lib/util'

// Two ways to let someone in:
//   a view link     no account needed; shows only what its switches allow
//   an invitation   adds someone with their own account, to view or to edit
export default function ShareDialog({ project, onClose }) {
  const toast = useToast()
  const pid = project.id
  const links = useAsync(() => api.shareLinks(pid), [pid])
  const people = useAsync(() => api.members(pid), [pid])
  const [error, setError] = useState(null)
  const [invite, setInvite] = useState(null)
  const [role, setRole] = useState('viewer')

  const attempt = async (fn) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    }
  }
  const copy = async (text, what) => (await copyText(text)) && toast(`${what} copied.`)

  return (
    <Modal title={`Share “${project.name}”`} onClose={onClose} wide>
      <div className="space-y-8">
        <ErrorNote>{error}</ErrorNote>

        <section>
          <h3 className="text-[1.15rem] mb-1 flex items-center gap-2"><Link2 size={17} /> View links</h3>
          <p className="hint mb-3">For showing a client. Anyone with the link can look, nobody can change anything, and you choose what’s included. Turn a link off and it stops working at once.</p>
          {links.loading && <Spinner />}
          <div className="space-y-3">
            {links.data?.map((link) => {
              const set = (changes) => attempt(async () => { const updated = await api.updateShareLink(pid, link.id, changes); links.setData((prev) => prev.map((l) => (l.id === link.id ? updated : l))) })
              return (
                <div key={link.id} className="border border-line rounded-lg p-3">
                  <div className="flex gap-2">
                    <input className="field !py-1.5 text-sm" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
                    <button className="btn btn-plain btn-sm !min-h-[36px]" onClick={() => copy(link.url, 'Link')}><Copy size={14} /> Copy</button>
                    <button className="btn btn-quiet btn-icon" title="Turn this link off" aria-label="Turn this link off" onClick={() => attempt(async () => { await api.deleteShareLink(pid, link.id); links.setData((prev) => prev.filter((l) => l.id !== link.id)) })}><Trash2 size={15} /></button>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
                    <Toggle checked={link.includeBoard} onChange={(v) => set({ includeBoard: v })} label="Board" />
                    <Toggle checked={link.includeBrand} onChange={(v) => set({ includeBrand: v })} label="Brand kit" />
                    <Toggle checked={link.includeBrief} onChange={(v) => set({ includeBrief: v })} label="Brief" />
                    <Toggle checked={link.includeNotes} onChange={(v) => set({ includeNotes: v })} label="Your notes" />
                  </div>
                </div>
              )
            })}
          </div>
          <button className="btn btn-plain btn-sm mt-3" onClick={() => attempt(async () => { const created = await api.createShareLink(pid, { includeBoard: true }); links.setData((prev) => [...(prev || []), created]) })}>
            <Link2 size={14} /> Create a view link
          </button>
        </section>

        <section>
          <h3 className="text-[1.15rem] mb-1 flex items-center gap-2"><UserPlus size={17} /> People on this project</h3>
          <p className="hint mb-3">An invitation link adds one person with their own Moodloom account. It works once and lasts seven days.</p>
          {people.loading && <Spinner />}
          <ul className="divide-y divide-line border-y border-line">
            {people.data?.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 min-w-0 truncate">
                  {m.name || m.email || 'Someone without a saved account'}
                  {m.you && <span className="text-mute"> (you)</span>}
                  {m.name && m.email && <span className="text-mute text-sm block truncate">{m.email}</span>}
                </span>
                {m.role === 'owner' ? (
                  <span className="chip">Owner</span>
                ) : (
                  <>
                    <select className="field !w-auto !py-1 text-sm" value={m.role} onChange={(e) => attempt(async () => { await api.setMemberRole(pid, m.id, e.target.value); people.reload() })} aria-label="Access">
                      <option value="viewer">Can view</option>
                      <option value="editor">Can edit</option>
                    </select>
                    <button className="btn btn-quiet btn-sm" onClick={() => attempt(async () => { await api.removeMember(pid, m.id); people.reload() })}>Remove</button>
                  </>
                )}
              </li>
            ))}
            {people.data?.invites.map((inv) => (
              <li key={`i${inv.id}`} className="flex items-center gap-3 py-2.5 text-mute">
                <span className="flex-1">Unused invitation to {inv.role === 'editor' ? 'edit' : 'view'}, made {timeAgo(inv.created_at)}</span>
                <button className="btn btn-quiet btn-sm" onClick={() => attempt(async () => { await api.deleteInvite(pid, inv.id); people.reload() })}>Cancel it</button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select className="field !w-auto !py-1.5 text-sm" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Invite as">
              <option value="viewer">Invite to view</option>
              <option value="editor">Invite to edit</option>
            </select>
            <button className="btn btn-primary btn-sm !min-h-[36px]" onClick={() => attempt(async () => { setInvite(await api.invite(pid, role)); people.reload() })}>Create invitation link</button>
          </div>
          {invite && (
            <div className="mt-3 bg-weld-soft rounded-lg p-3">
              <p className="text-sm mb-2">Send this to the person you’re inviting. It’s shown only this once.</p>
              <div className="flex gap-2">
                <input className="field !py-1.5 text-sm" readOnly value={invite.url} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
                <button className="btn btn-primary btn-sm !min-h-[36px]" onClick={() => copy(invite.url, 'Invitation link')}><Copy size={14} /> Copy</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
