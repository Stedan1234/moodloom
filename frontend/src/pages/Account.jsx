import { useEffect, useState } from 'react'
import { ChevronLeft, Download, LogOut, Puzzle, Smartphone } from 'lucide-react'
import { api } from '../api'
import { linkProps, navigate } from '../router'
import { ErrorNote, Field, Modal, Spinner, useAsync, useToast, Wordmark } from '../ui'
import { formatBytes } from '../lib/util'
import AuthDialog from '../AuthDialog'

function Row({ title, children, hint }) {
  return (
    <section className="grid md:grid-cols-[15rem_1fr] gap-x-10 gap-y-3 py-7 border-t border-line first:border-0">
      <div>
        <h2 className="text-[1.2rem]">{title}</h2>
        {hint && <p className="hint mt-1">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Meter({ label, used, limit, format = (n) => n }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-mute tabular-nums">{format(used)}{limit ? ` of ${format(limit)}` : ''}</span>
      </div>
      {limit ? (
        <div className="h-1.5 rounded-full bg-wall-deep overflow-hidden"><div className={`h-full rounded-full ${pct > 90 ? 'bg-madder' : 'bg-spruce'}`} style={{ width: `${pct}%` }} /></div>
      ) : null}
    </div>
  )
}

function Pairing() {
  const [code, setCode] = useState(null)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!code) return
    const tick = () => setLeft(Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [code])
  return (
    <div>
      <p className="mb-3">Install the Moodloom extension in Chrome or Edge, click its icon, and type this code. From then on, one click on any page saves it to the project you choose.</p>
      {code && left > 0 ? (
        <div className="inline-flex items-center gap-4 bg-weld-soft rounded-lg px-4 py-3">
          <span className="display text-3xl tracking-[0.18em]">{code.code}</span>
          <span className="text-sm text-mute">works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
        </div>
      ) : (
        <button className="btn btn-plain" onClick={async () => { setError(null); try { setCode(await api.pairingCode()) } catch (err) { setError(err.message) } }}>
          <Puzzle size={16} /> {code ? 'That code ran out. Get another' : 'Get a pairing code'}
        </button>
      )}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </div>
  )
}

export default function Account({ onSession }) {
  const toast = useToast()
  const account = useAsync(() => api.account(), [])
  const [auth, setAuth] = useState(null)
  const [name, setName] = useState('')
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwError, setPwError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const a = account.data
  useEffect(() => { if (a) setName(a.displayName || '') }, [a])

  if (account.loading && !a) return <div className="min-h-screen grid place-items-center"><Spinner /></div>
  if (account.error) return <div className="min-h-screen grid place-items-center p-8"><ErrorNote>{account.error.message}</ErrorNote></div>

  async function logout() {
    if (!a.claimed && !window.confirm('This account has no email or password, so logging out means you can’t get back to its projects. Log out anyway?')) return
    api.logout()
    onSession()
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 px-5 sm:px-10 py-4">
        <a {...linkProps('/')} className="btn btn-quiet btn-icon !w-auto !px-1.5" aria-label="Back to projects"><ChevronLeft size={18} /></a>
        <Wordmark />
      </header>
      <main className="max-w-4xl mx-auto px-5 sm:px-10 pb-20">
        <h1 className="text-[clamp(2rem,4.5vw,3rem)] mt-4 mb-6">Account</h1>
        <div className="sheet px-5 sm:px-8">
          <Row title="You" hint={a.claimed ? null : 'Not saved yet. This account exists only in this browser.'}>
            {a.claimed ? (
              <p className="mb-4">Signed in as <strong>{a.email}</strong></p>
            ) : (
              <div className="bg-weld-soft rounded-lg p-4 mb-4">
                <p className="mb-3">Add an email and password to open your projects on other devices, accept invitations, and get back in if this browser forgets you.</p>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => setAuth('save')}>Save my account</button>
                  <button className="btn btn-quiet" onClick={() => setAuth('login')}>Log in to another</button>
                </div>
              </div>
            )}
            <form className="flex gap-2 items-end max-w-md" onSubmit={async (e) => { e.preventDefault(); try { await api.updateAccount(name.trim() || null); toast('Name saved.'); account.reload() } catch (err) { toast(err.message, 'error') } }}>
              <Field label="Name others see on shared projects"><input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
              <button className="btn btn-plain" disabled={name.trim() === (a.displayName || '')}>Save</button>
            </form>
          </Row>

          {a.claimed && (
            <Row title="Password" hint="Changing it signs out every other browser and the extension.">
              <form className="space-y-3 max-w-sm" onSubmit={async (e) => {
                e.preventDefault()
                setPwError(null)
                if (pw.next.length < 8) return setPwError('Use at least 8 characters.')
                try { await api.changePassword(pw.current, pw.next); setPw({ current: '', next: '' }); toast('Password changed.') } catch (err) { setPwError(err.message) }
              }}>
                <Field label="Current password"><input className="field" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
                <Field label="New password"><input className="field" type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                <ErrorNote>{pwError}</ErrorNote>
                <button className="btn btn-plain">Change password</button>
              </form>
            </Row>
          )}

          <Row title="Browser extension"><Pairing /></Row>

          <Row title="On your phone">
            <p className="flex gap-3">
              <Smartphone size={20} className="shrink-0 mt-0.5 text-mute" />
              <span>Open Moodloom in your phone’s browser, log in, and choose “Add to Home Screen”. On Android, Moodloom then shows up in the share menu of other apps, so a link or image goes straight to a project. On any phone, the Upload button on a board opens the camera.</span>
            </p>
          </Row>

          <Row title="Plan and usage" hint={a.limitsEnforced ? null : 'Limits aren’t being enforced on this server.'}>
            <p className="mb-4">You’re on the <strong>{a.planLabel}</strong> plan.</p>
            <div className="space-y-4 max-w-md">
              <Meter label="Projects" used={a.usage.projects} limit={a.limits.projects} />
              <Meter label="Stored files" used={a.usage.storageBytes} limit={a.limits.storageBytes} format={formatBytes} />
              <Meter label="Direction notes this month" used={a.usage.directionNotes} limit={a.limits.directionNotes} />
            </div>
          </Row>

          <Row title="Your data" hint="Everything you’ve put in is yours to take out.">
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-plain" onClick={async () => { toast('Preparing the download…'); try { await api.exportAccount() } catch (err) { toast(err.message, 'error') } }}><Download size={16} /> Download everything as a ZIP</button>
              <button className="btn btn-plain" onClick={async () => { try { await api.logoutEverywhere(); toast('Signed out everywhere else. The extension needs pairing again.') } catch (err) { toast(err.message, 'error') } }}>Sign out everywhere else</button>
              <button className="btn btn-plain" onClick={logout}><LogOut size={16} /> Log out of this browser</button>
            </div>
            <button className="mt-6 text-sm text-madder underline" onClick={() => setDeleting(true)}>Delete this account and everything in it</button>
          </Row>
        </div>
      </main>

      {auth && (
        <AuthDialog
          mode={auth}
          onClose={() => setAuth(null)}
          onDone={(what) => {
            setAuth(null)
            if (what === 'saved') { toast('Account saved.'); account.reload() } else { onSession(); navigate('/') }
          }}
        />
      )}
      {deleting && <DeleteAccount claimed={a.claimed} onClose={() => setDeleting(false)} onDone={() => { api.logout(); onSession(); navigate('/', { replace: true }) }} />}
    </div>
  )
}

function DeleteAccount({ claimed, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Delete your account?" onClose={onClose}>
      <div className="space-y-4">
        <p>This permanently removes your account, every project you own, and every file in them. Projects other people shared with you are not affected. It can’t be undone.</p>
        {claimed && <Field label="Your password"><input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        <Field label="Type DELETE to confirm"><input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-danger w-full" disabled={busy || typed !== 'DELETE'} onClick={async () => {
          setBusy(true)
          try { await api.deleteAccount(password || undefined); onDone() } catch (err) { setError(err.message); setBusy(false) }
        }}>Delete everything</button>
      </div>
    </Modal>
  )
}
