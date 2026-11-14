import { useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Field, Wordmark } from '../ui'

// Opened from the emailed reset link. On success the browser is signed in
// and sent to the projects page, which also drops the one-time token from
// the address bar.
export default function Reset({ token, onSession }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(token ? null : 'This reset link is incomplete. Open the link from the email again, or ask for a new one.')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      onSession()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <Wordmark />
        <h1 className="text-3xl mt-8 mb-5">Choose a new password</h1>
        <form onSubmit={submit} className="sheet p-5 space-y-3.5">
          <Field label="New password"><input className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="New password again"><input className="field" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full" disabled={busy || !token}>{busy ? 'One moment…' : 'Set password and log in'}</button>
        </form>
        <button className="mt-4 text-sm text-mute underline" onClick={() => navigate('/', { replace: true })}>Back to Moodloom</button>
      </div>
    </div>
  )
}
