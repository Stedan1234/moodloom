// API client. One origin: in development Vite proxies /api and /uploads to
// the backend, in production the backend serves this app itself.
const API = (import.meta.env.VITE_API_BASE || '') + '/api'
const TOKEN_KEY = 'moodloom_token'

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* private mode: the session lasts for this page only */
    }
    memoryToken = token
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* nothing to clear */
    }
    memoryToken = null
  },
}
let memoryToken = null
const currentToken = () => session.token || memoryToken

let creating = null
// Accounts are anonymous until someone chooses to save theirs, so the first
// call that needs one makes it. Shared promise: ten parallel calls on first
// load must not create ten accounts.
async function ensureToken() {
  const existing = currentToken()
  if (existing) return existing
  if (!creating) {
    creating = fetch(`${API}/auth/anonymous`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) throw new ApiError('Moodloom could not start a session. Is the server running?', res.status)
        const data = await res.json()
        session.set(data.token)
        return data.token
      })
      .finally(() => {
        creating = null
      })
  }
  return creating
}

async function readError(res) {
  const body = await res.json().catch(() => ({}))
  return new ApiError(body.error || `Request failed (${res.status})`, res.status, body.code)
}

async function request(path, { method = 'GET', body, auth = true, form } = {}) {
  const headers = {}
  if (auth) headers.Authorization = `Bearer ${await ensureToken()}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) })
  } catch {
    throw new ApiError('Can’t reach Moodloom. Check your connection, or that the server is running.', 0, 'NETWORK')
  }
  if (res.status === 401 && auth) {
    // The stored token no longer verifies (signed out everywhere, password
    // changed elsewhere). Drop it and tell the app, which decides what to show.
    session.clear()
    window.dispatchEvent(new Event('moodloom:signed-out'))
    throw new ApiError('You’ve been signed out. Log in again to carry on.', 401, 'SIGNED_OUT')
  }
  if (!res.ok) throw await readError(res)
  if (res.status === 204) return null
  return res.json()
}

const get = (path) => request(path)
const post = (path, body) => request(path, { method: 'POST', body: body ?? {} })
const patch = (path, body) => request(path, { method: 'PATCH', body })
const put = (path, body) => request(path, { method: 'PUT', body })
const del = (path, body) => request(path, { method: 'DELETE', body })

// Downloads go through fetch (the token lives in a header, not a cookie),
// then are handed to the browser as a file.
async function download(path, fallbackName) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await ensureToken()}` } })
  if (!res.ok) throw await readError(res)
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const api = {
  hasSession: () => Boolean(currentToken()),
  start: ensureToken,

  // account
  account: () => get('/account'),
  updateAccount: (displayName) => patch('/account', { displayName }),
  claim: (email, password) => post('/auth/claim', { email, password }),
  login: async (email, password) => {
    const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false })
    session.set(data.token)
  },
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  resetPassword: async (token, password) => {
    const data = await request('/auth/reset-password', { method: 'POST', body: { token, password }, auth: false })
    session.set(data.token)
  },
  changePassword: async (currentPassword, newPassword) => {
    const data = await post('/account/password', { currentPassword, newPassword })
    session.set(data.token)
  },
  logoutEverywhere: async () => {
    const data = await post('/account/logout-all')
    session.set(data.token)
  },
  logout: () => session.clear(),
  deleteAccount: (password) => del('/account', { password, confirm: 'DELETE' }),
  exportAccount: () => download('/account/export', 'moodloom-export.zip'),
  pairingCode: () => post('/auth/pairing-code'),

  // projects
  projects: () => get('/projects'),
  createProject: (name) => post('/projects', { name }),
  project: (id) => get(`/projects/${id}`),
  updateProject: (id, changes) => patch(`/projects/${id}`, changes),
  deleteProject: (id) => del(`/projects/${id}`),
  exportProject: (id) => download(`/projects/${id}/export`, 'moodloom-project.zip'),
  search: (q) => get(`/search?q=${encodeURIComponent(q)}`),

  // board
  items: (pid) => get(`/projects/${pid}/items`),
  capture: (pid, data) => post(`/projects/${pid}/items`, data),
  upload: (pid, file, { categoryId, title, note } = {}) => {
    const form = new FormData()
    form.append('file', file, file.name || 'pasted-image.png')
    if (categoryId) form.append('categoryId', String(categoryId))
    if (title) form.append('title', title)
    if (note) form.append('note', note)
    return request(`/projects/${pid}/items/upload`, { method: 'POST', form })
  },
  addQuote: (pid, data) => post(`/projects/${pid}/items/quote`, data),
  updateItem: (pid, id, changes) => patch(`/projects/${pid}/items/${id}`, changes),
  deleteItem: (pid, id) => del(`/projects/${pid}/items/${id}`),
  reorder: (pid, ids) => post(`/projects/${pid}/items/reorder`, { ids }),
  similar: (pid, id) => get(`/projects/${pid}/items/${id}/similar`),
  importLinks: (pid, links, { categoryId, tag } = {}) => post(`/projects/${pid}/items/import`, { links, categoryId, tag: tag || undefined }),
  commentCounts: (pid) => get(`/projects/${pid}/items/comment-counts`),
  comments: (pid, id) => get(`/projects/${pid}/items/${id}/comments`),
  addComment: (pid, id, body) => post(`/projects/${pid}/items/${id}/comments`, { body }),
  deleteComment: (pid, id, commentId) => del(`/projects/${pid}/items/${id}/comments/${commentId}`),

  categories: (pid) => get(`/projects/${pid}/categories`),
  createCategory: (pid, name, itemIds) => post(`/projects/${pid}/categories`, { name, itemIds }),
  updateCategory: (pid, id, changes) => patch(`/projects/${pid}/categories/${id}`, changes),
  deleteCategory: (pid, id) => del(`/projects/${pid}/categories/${id}`),

  // notes, sketch, brand kit
  notes: (pid) => get(`/projects/${pid}/workspace`),
  saveNotes: (pid, content) => put(`/projects/${pid}/workspace`, { content }),
  sketch: (pid) => get(`/projects/${pid}/canvas`),
  saveSketch: (pid, scene) => put(`/projects/${pid}/canvas`, { scene }),
  brand: (pid) => get(`/projects/${pid}/brand`),
  saveBrand: (pid, data) => put(`/projects/${pid}/brand`, { data }),

  // direction
  aiStatus: (pid) => get(`/projects/${pid}/ai/status`),
  digest: (pid, categoryId) => get(`/projects/${pid}/ai/digest${categoryId ? `?categoryId=${categoryId}` : ''}`),
  groupings: (pid) => post(`/projects/${pid}/ai/groupings`),
  suggestCategory: (pid, itemId) => get(`/projects/${pid}/ai/suggest-category?itemId=${itemId}`),
  describeSearch: (pid, q) => get(`/projects/${pid}/ai/search?q=${encodeURIComponent(q)}`),
  directionNotes: (pid) => get(`/projects/${pid}/ai/direction`),
  writeDirection: (pid, data) => post(`/projects/${pid}/ai/direction`, data),
  deleteDirection: (pid, id) => del(`/projects/${pid}/ai/direction/${id}`),

  // sharing
  shareLinks: (pid) => get(`/projects/${pid}/share-links`),
  createShareLink: (pid, options) => post(`/projects/${pid}/share-links`, options),
  updateShareLink: (pid, id, options) => patch(`/projects/${pid}/share-links/${id}`, options),
  deleteShareLink: (pid, id) => del(`/projects/${pid}/share-links/${id}`),
  members: (pid) => get(`/projects/${pid}/members`),
  invite: (pid, role) => post(`/projects/${pid}/invites`, { role }),
  deleteInvite: (pid, id) => del(`/projects/${pid}/invites/${id}`),
  setMemberRole: (pid, userId, role) => patch(`/projects/${pid}/members/${userId}`, { role }),
  removeMember: (pid, userId) => del(`/projects/${pid}/members/${userId}`),

  // no account needed
  shared: (token) => request(`/share/${token}`, { auth: false }),
  invitePreview: (token) => request(`/invites/${token}`, { auth: false }),
  acceptInvite: (token) => post(`/invites/${token}/accept`),
}
