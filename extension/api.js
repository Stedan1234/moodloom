// Thin API client. Per mvp-scope.md, the extension should stay as thin as
// possible — it captures and hands off, it doesn't duplicate app logic.
// API_BASE points at local dev for now; swap this for the deployed backend
// URL (and add that origin to manifest.json's host_permissions) before
// dogfooding from outside this machine.
const API_BASE = 'http://localhost:3001';

// IMPORTANT: this no longer auto-creates its own anonymous account. Doing
// that silently was the root cause of a real bug found during real-machine
// testing — the extension and the web app each created a SEPARATE anonymous
// user, so a capture made here never showed up there. Now the extension has
// no identity of its own: it must be paired to the web app's account via a
// short-lived code (see /auth/pair on the backend, and popup.js for the UI).
async function getToken() {
  const stored = await chrome.storage.local.get('token');
  return stored.token || null;
}

async function setToken(token) {
  await chrome.storage.local.set({ token });
}

async function clearToken() {
  await chrome.storage.local.remove('token');
}

async function pair(code) {
  const res = await fetch(`${API_BASE}/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  await setToken(data.token);
  return data.token;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  if (!token) {
    throw new Error('NOT_PAIRED');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    // The token is stale (e.g. server data reset) — clear it so the popup
    // drops back to the pairing screen instead of failing silently forever.
    await clearToken();
    throw new Error('NOT_PAIRED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  isPaired: async () => Boolean(await getToken()),
  pair,
  unpair: clearToken,
  listProjects: () => apiFetch('/projects'),
  createProject: (name) =>
    apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  captureItem: (projectId, sourceUrl, title) =>
    apiFetch(`/projects/${projectId}/items`, {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, title }),
    }),
};
