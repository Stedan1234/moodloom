// Talks to a Moodloom server on behalf of the extension.
//
// The extension never creates an account of its own. It is paired once with
// the account the web app is using (Account → Browser extension → pairing
// code), and from then on holds a token for that same account. The server
// address is whatever was typed when pairing, so the same extension works
// against a local server and a deployed one.
export const DEFAULT_SERVER = 'http://localhost:3001';

export async function getSettings() {
  const { moodloom_server, moodloom_token, moodloom_last } = await chrome.storage.local.get(['moodloom_server', 'moodloom_token', 'moodloom_last']);
  return { server: moodloom_server || DEFAULT_SERVER, token: moodloom_token || null, last: moodloom_last || {} };
}

export function normaliseServer(input) {
  const raw = (input || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_SERVER;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme); // throws on nonsense, which the popup reports
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Use an https:// address. Plain http is only allowed for localhost.');
  }
  return url.origin;
}

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `The server answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function pair(serverInput, code) {
  const server = normaliseServer(serverInput);
  let res;
  try {
    res = await fetch(`${server}/api/auth/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  } catch {
    throw new Error(`Can’t reach ${server}. Check the address, and that Moodloom is running.`);
  }
  const data = await parse(res);
  await chrome.storage.local.set({ moodloom_server: server, moodloom_token: data.token });
}

export async function disconnect() {
  await chrome.storage.local.remove(['moodloom_token', 'moodloom_last']);
}

export async function rememberLast(last) {
  await chrome.storage.local.set({ moodloom_last: last });
}

async function request(path, options = {}) {
  const { server, token } = await getSettings();
  if (!token) {
    const err = new Error('Not paired with a Moodloom account yet.');
    err.status = 401;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${server}/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  } catch {
    throw new Error(`Can’t reach ${server}. Is Moodloom running?`);
  }
  if (res.status === 401) {
    // Signed out everywhere or password changed: this token is finished.
    await disconnect();
  }
  return parse(res);
}

export const api = {
  projects: () => request('/projects'),
  createProject: (name) => request('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  categories: (projectId) => request(`/projects/${projectId}/categories`),
  capture: (projectId, data) => request(`/projects/${projectId}/items`, { method: 'POST', body: JSON.stringify(data) }),
};
