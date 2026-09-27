// API client for the web app. Same auth-token pattern as extension/api.js
// (anonymous-by-default, token persisted client-side) but using localStorage
// since this runs in an ordinary tab, not a Chrome extension.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const TOKEN_KEY = 'moodloom_token';

async function getOrCreateToken() {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  const res = await fetch(`${API_BASE}/auth/anonymous`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create a session');
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

async function apiFetch(path, options = {}) {
  const token = await getOrCreateToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    // The stored token no longer verifies (e.g. a JWT_SECRET rotation, or a
    // stale value from an old install). Previously this just showed "Invalid
    // or expired token" forever with no way forward. Clearing it here means
    // the NEXT call gets a fresh anonymous token automatically — the same
    // self-healing behavior the extension already had.
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('Your session needed to be refreshed — please try that again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function rawFetch(path, options = {}) {
  // For calls that must NOT attach (or create) the current token, namely
  // /auth/login — logging in should never auto-provision an anonymous
  // account first, it should go straight to the real account.
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  listProjects: () => apiFetch('/projects'),
  createProject: (name) =>
    apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (id) => apiFetch(`/projects/${id}`),
  renameProject: (id, name) =>
    apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProject: (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),

  listItems: (projectId) => apiFetch(`/projects/${projectId}/items`),
  captureItem: (projectId, sourceUrl, title) =>
    apiFetch(`/projects/${projectId}/items`, {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, title }),
    }),
  deleteItem: (projectId, itemId) =>
    apiFetch(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' }),

  // Uploads an image file (from a file picker, or a pasted screenshot handed
  // in as a Blob) as a new board item. Can't reuse apiFetch here — it always
  // sets Content-Type: application/json, but multipart/form-data needs the
  // browser to set its own Content-Type (with the multipart boundary), so
  // the token is attached manually and Content-Type is left for fetch to fill in.
  uploadItem: async (projectId, file) => {
    const token = await getOrCreateToken();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/items/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      throw new Error('Your session needed to be refreshed — please try that again.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Upload failed (${res.status})`);
    }
    return res.json();
  },

  getWorkspace: (projectId) => apiFetch(`/projects/${projectId}/workspace`),
  saveWorkspace: (projectId, content) =>
    apiFetch(`/projects/${projectId}/workspace`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  // Generates a short-lived code the browser extension can redeem so it logs
  // into this SAME account, instead of silently creating its own separate one.
  getPairingCode: () => apiFetch('/auth/pairing-code', { method: 'POST' }),

  // Whether the CURRENT account has an email on file. An anonymous account
  // with no email has no recovery path at all if its token is ever lost.
  getMe: () => apiFetch('/auth/me'),

  // Attaches an email + password to the current (anonymous) account so it
  // can survive a lost/cleared token or be recovered on another device.
  claimAccount: (email, password) =>
    apiFetch('/auth/claim', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // Recovers a previously-claimed account on this browser — deliberately
  // bypasses the current token entirely rather than trying to attach to it.
  login: async (email, password) => {
    const data = await rawFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  },
};
