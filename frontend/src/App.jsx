import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './api'
import { match, navigate, useLocation } from './router'
import { Spinner, ToastProvider } from './ui'
import Welcome from './pages/Welcome'
import Home from './pages/Home'

// Everything past the first two screens loads when it's needed.
const Project = lazy(() => import('./pages/Project'))
const Account = lazy(() => import('./pages/Account'))
const Shared = lazy(() => import('./pages/Shared'))
const Invite = lazy(() => import('./pages/Invite'))
const Reset = lazy(() => import('./pages/Reset'))
const ShareTarget = lazy(() => import('./pages/ShareTarget'))

function Screen({ path, query }) {
  // Bumped when the session changes so screens re-read who is signed in.
  const [sessionKey, setSessionKey] = useState(0)
  useEffect(() => {
    const onSignedOut = () => {
      setSessionKey((k) => k + 1)
      navigate('/', { replace: true })
    }
    window.addEventListener('moodloom:signed-out', onSignedOut)
    return () => window.removeEventListener('moodloom:signed-out', onSignedOut)
  }, [])
  const refresh = () => setSessionKey((k) => k + 1)

  let m
  if ((m = match('/s/:token', path))) return <Shared token={m.token} />
  if ((m = match('/invite/:token', path))) return <Invite token={m.token} onSession={refresh} />
  if (match('/reset', path)) return <Reset token={query.get('token') || ''} onSession={refresh} />
  // Links emailed before the app had real paths.
  if (path === '/' && query.get('reset_token')) return <Reset token={query.get('reset_token')} onSession={refresh} />

  if (!api.hasSession()) {
    // Deep links (a project, a share from the phone) land on the welcome
    // screen first; after starting or logging in they carry on to where
    // they were going.
    return <Welcome key={sessionKey} onSession={refresh} next={path === '/' ? null : path + window.location.search} />
  }
  if ((m = match('/p/:id/:tab?', path))) return <Project key={`${m.id}-${sessionKey}`} projectId={m.id} tab={m.tab || 'board'} openItemId={query.get('item')} />
  if (match('/account', path)) return <Account key={sessionKey} onSession={refresh} />
  if (match('/share-target', path)) return <ShareTarget query={query} />
  if (path === '/') return <Home key={sessionKey} />
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <h1 className="text-3xl mb-2">Nothing at this address</h1>
        <p className="text-mute mb-5">The link may be mistyped, or the page has moved.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Go to your projects
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { path, query } = useLocation()
  return (
    <ToastProvider>
      <Suspense
        fallback={
          <div className="min-h-screen grid place-items-center">
            <Spinner />
          </div>
        }
      >
        <Screen path={path} query={query} />
      </Suspense>
    </ToastProvider>
  )
}
