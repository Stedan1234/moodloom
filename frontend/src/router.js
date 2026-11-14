// A very small router on the History API. Moodloom has a dozen screens and
// no nested data loading, so a routing library would be more than it needs.
import { useEffect, useState } from 'react'

const listeners = new Set()

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to)
  listeners.forEach((fn) => fn())
  window.scrollTo(0, 0)
}

export function useLocation() {
  const read = () => ({ path: window.location.pathname, query: new URLSearchParams(window.location.search) })
  const [location, setLocation] = useState(read)
  useEffect(() => {
    const update = () => setLocation(read())
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return location
}

// match('/p/:id/:tab?', '/p/12/brief') -> { id: '12', tab: 'brief' }
export function match(pattern, path) {
  const want = pattern.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  const params = {}
  for (let i = 0; i < want.length; i++) {
    const part = want[i]
    const optional = part.endsWith('?')
    const name = part.replace(/^:|\?$/g, '')
    if (part.startsWith(':')) {
      if (have[i] === undefined) {
        if (optional) continue
        return null
      }
      params[name] = decodeURIComponent(have[i])
    } else if (have[i] !== part) return null
  }
  return have.length > want.length ? null : params
}

// For plain <a> elements: keep ctrl/cmd-click and middle-click working.
export function linkProps(to) {
  return {
    href: to,
    onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      navigate(to)
    },
  }
}
