import { useState } from 'react'
import { api } from './api'
import { ErrorNote, Field, Modal } from './ui'

// One dialog for the three things someone does with an email and password:
//   save   attach them to the account this browser is already using
//   login  switch this browser to an account saved earlier
//   forgot ask for a reset link
export default function AuthDialog({ mode: initialMode = 'login', onClose, onDone, allowSave = true }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (mode === 'save') {
      if (password.length < 8) return setError('Use at least 8 characters for the password.')
      if (password !== confirm) return setError('The two passwords don’t match.')
    }
    setBusy(true)
    try {
      if (mode === 'save') {
        await api.claim(email.trim(), password)
        onDone('saved')
      } else if (mode === 'login') {
        await api.login(email.trim(), password)
        onDone('logged-in')
      } else {
        const res = await api.forgotPassword(email.trim())
        setSent(res.message)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'save' ? 'Save your account' : mode === 'login' ? 'Log in' : 'Reset your password'
  return (
    <Modal title={title} onClose={onClose}>
      {sent ? (
        <div className="space-y-4">
          <p>{sent}</p>
          <p className="hint">The link works once and lasts an hour. Check spam if it hasn’t arrived in a few minutes.</p>
          <button className="btn btn-primary w-full" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          {mode === 'save' && (
            <p className="hint">
              Right now your projects live only in this browser. With an email and password you can open them anywhere, and get back in if this browser forgets you.
            </p>
          )}
          {mode === 'login' && allowSave && api.hasSession() && (
            <p className="hint">Logging in switches this browser to that account. Anything made here without an account stays behind.</p>
          )}
          <Field label="Email">
            <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode !== 'forgot' && (
            <Field label="Password">
              <input
                className="field"
                type="password"
                required
                autoComplete={mode === 'save' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {mode === 'save' && (
            <Field label="Password again">
              <input className="field" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          )}
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'One moment…' : mode === 'save' ? 'Save account' : mode === 'login' ? 'Log in' : 'Send reset link'}
          </button>
          <div className="flex justify-between text-sm text-mute pt-1">
            {mode === 'login' ? (
              <>
                <button type="button" className="underline" onClick={() => { setMode('forgot'); setError(null) }}>
                  Forgot password?
                </button>
                {allowSave && api.hasSession() && (
                  <button type="button" className="underline" onClick={() => { setMode('save'); setError(null) }}>
                    Save this account instead
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="underline" onClick={() => { setMode('login'); setError(null) }}>
                {mode === 'save' ? 'I already have an account' : 'Back to log in'}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}
