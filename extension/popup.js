const pairingView = document.getElementById('pairing-view');
const pairingCodeInput = document.getElementById('pairing-code-input');
const pairBtn = document.getElementById('pair-btn');
const pairingStatus = document.getElementById('pairing-status');

const captureView = document.getElementById('capture-view');
const pagePreview = document.getElementById('page-preview');
const projectSelect = document.getElementById('project-select');
const newProjectInput = document.getElementById('new-project-name');
const categorySelect = document.getElementById('category-select');
const captureBtn = document.getElementById('capture-btn');
const status = document.getElementById('status');
const unpairLink = document.getElementById('unpair-link');

const NEW_PROJECT_VALUE = '__new__';

let currentTab = null;

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = kind || '';
}

async function showPairingView() {
  captureView.style.display = 'none';
  pairingView.style.display = 'block';
  pairingCodeInput.value = '';
  pairingCodeInput.focus();
}

async function showCaptureView() {
  pairingView.style.display = 'none';
  captureView.style.display = 'block';
  await initCapture();
}

pairBtn.addEventListener('click', async () => {
  const code = pairingCodeInput.value.trim();
  if (!code) {
    setStatus(pairingStatus, 'Enter the code shown in the web app', 'error');
    return;
  }
  pairBtn.disabled = true;
  setStatus(pairingStatus, 'Connecting…');
  try {
    await api.pair(code);
    setStatus(pairingStatus, '');
    await showCaptureView();
  } catch (err) {
    setStatus(pairingStatus, err.message, 'error');
  } finally {
    pairBtn.disabled = false;
  }
});

unpairLink.addEventListener('click', async () => {
  await api.unpair();
  await showPairingView();
});

async function initCapture() {
  // Grab the active tab's URL/title via the `activeTab` permission — this is
  // the whole point: capture what's on screen right now, no manual pasting.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  pagePreview.textContent = tab?.title ? `${tab.title}\n${tab.url}` : tab?.url || 'No page detected';

  try {
    const projects = await api.listProjects();
    projectSelect.innerHTML = '';

    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    }

    const newOption = document.createElement('option');
    newOption.value = NEW_PROJECT_VALUE;
    newOption.textContent = '+ New project…';
    projectSelect.appendChild(newOption);

    // If there are no existing projects yet, jump straight to "new project"
    // mode instead of showing an empty, confusing dropdown.
    if (projects.length === 0) {
      projectSelect.value = NEW_PROJECT_VALUE;
      newProjectInput.style.display = 'block';
      setCategoryOptions([], { disabled: true });
    } else {
      await loadCategoriesFor(projectSelect.value);
    }

    captureBtn.disabled = false;
  } catch (err) {
    if (err.message === 'NOT_PAIRED') {
      await showPairingView();
      return;
    }
    setStatus(status, err.message, 'error');
  }
}

// Populates the category dropdown for a given project, or resets it to just
// "Uncategorized" (disabled) when there's no real project yet to draw
// categories from — i.e. while "+ New project…" is selected, since that
// project doesn't exist until Add to board is actually clicked.
function setCategoryOptions(categories, { disabled } = {}) {
  categorySelect.innerHTML = '<option value="">Uncategorized</option>';
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.appendChild(option);
  }
  categorySelect.disabled = Boolean(disabled);
}

async function loadCategoriesFor(projectId) {
  try {
    const categories = await api.listCategories(projectId);
    setCategoryOptions(categories);
  } catch {
    // Non-fatal — worst case, this capture just goes in as Uncategorized.
    setCategoryOptions([]);
  }
}

projectSelect.addEventListener('change', async () => {
  const isNewProject = projectSelect.value === NEW_PROJECT_VALUE;
  newProjectInput.style.display = isNewProject ? 'block' : 'none';
  if (isNewProject) {
    setCategoryOptions([], { disabled: true });
  } else {
    await loadCategoriesFor(projectSelect.value);
  }
});

captureBtn.addEventListener('click', async () => {
  if (!currentTab?.url) {
    setStatus(status, 'No page URL to capture', 'error');
    return;
  }

  captureBtn.disabled = true;
  setStatus(status, 'Adding…');

  try {
    let projectId = projectSelect.value;

    if (projectId === NEW_PROJECT_VALUE) {
      const name = newProjectInput.value.trim();
      if (!name) {
        setStatus(status, 'Enter a name for the new project', 'error');
        captureBtn.disabled = false;
        return;
      }
      const project = await api.createProject(name);
      projectId = project.id;
    }

    // categorySelect is disabled (and forced to "Uncategorized") whenever a
    // brand-new project was just created, since that project has no
    // categories to show until after this request completes.
    const categoryId = categorySelect.disabled ? '' : categorySelect.value;
    const result = await api.captureItem(projectId, currentTab.url, currentTab.title, categoryId);
    // The backend de-dupes by URL — clicking "Add to board" twice (or the
    // popup re-firing before the first request finished) no longer creates
    // a second board item, it just returns the one already there.
    setStatus(
      status,
      result.alreadyOnBoard ? 'Already on this board' : 'Added to board ✓',
      'success'
    );
  } catch (err) {
    if (err.message === 'NOT_PAIRED') {
      await showPairingView();
      return;
    }
    setStatus(status, err.message, 'error');
  } finally {
    captureBtn.disabled = false;
  }
});

async function init() {
  if (await api.isPaired()) {
    await showCaptureView();
  } else {
    await showPairingView();
  }
}

init();
