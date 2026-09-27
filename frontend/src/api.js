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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
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

  getWorkspace: (projectId) => apiFetch(`/projects/${projectId}/workspace`),
  saveWorkspace: (projectId, content) =>
    apiFetch(`/projects/${projectId}/workspace`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
};
