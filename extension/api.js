// Thin API client. Per mvp-scope.md, the extension should stay as thin as
// possible — it captures and hands off, it doesn't duplicate app logic.
// API_BASE points at local dev for now; swap this for the deployed backend
// URL (and add that origin to manifest.json's host_permissions) before
// dogfooding from outside this machine.
const API_BASE = 'http://localhost:3001';

async function getOrCreateToken() {
  const stored = await chrome.storage.local.get('token');
  if (stored.token) return stored.token;

  const res = await fetch(`${API_BASE}/auth/anonymous`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create an anonymous session');
  const data = await res.json();
  await chrome.storage.local.set({ token: data.token });
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

const api = {
  listProjects: () => apiFetch('/projects'),
  createProject: (name) =>
    apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  captureItem: (projectId, sourceUrl, title) =>
    apiFetch(`/projects/${projectId}/items`, {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, title }),
    }),
};
