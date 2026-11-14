import { useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Spinner, useAsync, Wordmark } from '../ui'
import AuthDialog from '../AuthDialog'

// Opened from an invitation link. Joining needs a saved account, because a
// membership on an anonymous one would vanish with the browser's storage.
export default function Invite({ token, onSession }) {
  const invite = useAsync(() => api.invitePreview(token), [token])
  const account = useAsync(() => (api.hasSession() ? api.account() : Promise.resolve(null)), [token])
  const [auth, setAuth] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.acceptInvite(token)
      onSession()
      navigate(`/p/${res.projectId}`, { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const claimed = account.data?.claimed
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <Wordmark />
        {invite.loading && <div className="mt-8"><Spinner /></div>}
        {invite.error && (
          <>
            <h1 className="text-3xl mt-8 mb-2">This invitation can’t be used</h1>
            <p className="text-mute">It has expired or someone already accepted it. Ask whoever sent it for a new one.</p>
          </>
        )}
        {invite.data && (
          <>
            <h1 className="text-3xl mt-8 mb-2">You’re invited to “{invite.data.projectName}”</h1>
            <p className="text-mute mb-6">You’ll be able to {invite.data.role === 'editor' ? 'add to it and edit it' : 'look, but not change anything'}.</p>
            <div className="sheet p-5 space-y-3">
              {claimed ? (
                <>
                  <p>Join as <strong>{account.data.email}</strong>?</p>
                  <button className="btn btn-primary w-full" onClick={accept} disabled={busy}>{busy ? 'Joining…' : 'Join the project'}</button>
                </>
              ) : (
                <>
                  <p>Joining needs an account with an email, so the project is still there next time you log in.</p>
                  <button className="btn btn-primary w-full" onClick={() => setAuth(api.hasSession() ? 'save' : 'login')}>{api.hasSession() ? 'Save my account and join' : 'Log in to join'}</button>
                  {!api.hasSession() && (
                    <button className="btn btn-plain w-full" onClick={async () => { await api.start(); setAuth('save') }}>I’m new. Make an account</button>
                  )}
                </>
              )}
              <ErrorNote>{error}</ErrorNote>
            </div>
          </>
        )}
      </div>
      {auth && (
        <AuthDialog
          mode={auth}
          onClose={() => setAuth(null)}
          onDone={() => {
            setAuth(null)
            onSession()
            accept()
          }}
        />
      )}
    </div>
  )
}
