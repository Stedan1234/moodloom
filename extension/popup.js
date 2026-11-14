import { api, disconnect, getSettings, pair, rememberLast, DEFAULT_SERVER } from './api.js';

const $ = (id) => document.getElementById(id);
const NEW = '__new__';
let tab = null;

function status(message, kind = 'ok') {
  const el = $('status');
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `status ${kind}`;
}

function option(value, label) {
  const o = document.createElement('option');
  o.value = String(value);
  o.textContent = label; // textContent: project names are never parsed as HTML
  return o;
}

async function showPairing(message) {
  $('capture').hidden = true;
  $('disconnect').hidden = true;
  $('pairing').hidden = false;
  const { server } = await getSettings();
  $('server').value = server === DEFAULT_SERVER ? '' : server;
  if (message) status(message, 'error');
  $('code').focus();
}

async function loadCategories(projectId, selected) {
  const select = $('category');
  select.replaceChildren(option('', 'Loose (no thread)'));
  select.disabled = projectId === NEW;
  if (projectId === NEW) return;
  try {
    for (const c of await api.categories(projectId)) select.appendChild(option(c.id, c.name));
    if (selected && [...select.options].some((o) => o.value === String(selected))) select.value = String(selected);
  } catch {
    /* threads are optional; saving still works without them */
  }
}

async function showCapture() {
  $('pairing').hidden = true;
  $('capture').hidden = false;
  $('disconnect').hidden = false;

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const saveable = /^https?:\/\//i.test(tab?.url || '');
  $('page-title').textContent = tab?.title || 'This page';
  $('page-url').textContent = tab?.url || '';
  $('save-button').disabled = !saveable;
  if (!saveable) status('This kind of page can’t be saved. Open a normal web page and try again.', 'error');

  let projects;
  try {
    projects = (await api.projects()).filter((p) => p.role !== 'viewer');
  } catch (err) {
    if (err.status === 401) return showPairing('This browser was signed out. Pair it again with a new code.');
    return status(err.message, 'error');
  }
  const { last } = await getSettings();
  const select = $('project');
  select.replaceChildren(...projects.map((p) => option(p.id, p.name)), option(NEW, 'A new project…'));
  select.value = projects.some((p) => String(p.id) === String(last.projectId)) ? String(last.projectId) : projects.length ? String(projects[0].id) : NEW;
  $('new-project').hidden = select.value !== NEW;
  await loadCategories(select.value, last.categoryId);
}

$('project').addEventListener('change', async (e) => {
  $('new-project').hidden = e.target.value !== NEW;
  if (e.target.value === NEW) $('new-project').focus();
  await loadCategories(e.target.value);
});

$('pairing').addEventListener('submit', async (e) => {
  e.preventDefault();
  status('');
  $('pair-button').disabled = true;
  try {
    await pair($('server').value, $('code').value.trim().toUpperCase());
    $('code').value = '';
    await showCapture();
  } catch (err) {
    status(err.message, 'error');
  } finally {
    $('pair-button').disabled = false;
  }
});

$('capture').addEventListener('submit', async (e) => {
  e.preventDefault();
  status('');
  const button = $('save-button');
  button.disabled = true;
  try {
    let projectId = $('project').value;
    if (projectId === NEW) {
      const name = $('new-project').value.trim();
      if (!name) throw new Error('Give the new project a name.');
      projectId = String((await api.createProject(name)).id);
    }
    const categoryId = $('category').value ? Number($('category').value) : undefined;
    const result = await api.capture(projectId, { sourceUrl: tab.url, title: tab.title?.slice(0, 300), note: $('note').value.trim() || undefined, categoryId });
    await rememberLast({ projectId, categoryId: categoryId || null });
    status(result.alreadyOnBoard ? 'Already on that board.' : 'Saved. It’s on the board.');
    $('note').value = '';
    if ($('project').value === NEW) await showCapture();
  } catch (err) {
    if (err.status === 401) return showPairing('This browser was signed out. Pair it again with a new code.');
    status(err.message, 'error');
  } finally {
    button.disabled = !/^https?:\/\//i.test(tab?.url || '');
  }
});

$('disconnect').addEventListener('click', async () => {
  await disconnect();
  status('');
  await showPairing();
});

getSettings().then(({ token }) => (token ? showCapture() : showPairing()));
