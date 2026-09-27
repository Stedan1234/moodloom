const pagePreview = document.getElementById('page-preview');
const projectSelect = document.getElementById('project-select');
const newProjectInput = document.getElementById('new-project-name');
const captureBtn = document.getElementById('capture-btn');
const status = document.getElementById('status');

const NEW_PROJECT_VALUE = '__new__';

let currentTab = null;

function setStatus(message, kind) {
  status.textContent = message;
  status.className = kind || '';
}

async function init() {
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
    }

    captureBtn.disabled = false;
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

projectSelect.addEventListener('change', () => {
  newProjectInput.style.display = projectSelect.value === NEW_PROJECT_VALUE ? 'block' : 'none';
});

captureBtn.addEventListener('click', async () => {
  if (!currentTab?.url) {
    setStatus('No page URL to capture', 'error');
    return;
  }

  captureBtn.disabled = true;
  setStatus('Adding…');

  try {
    let projectId = projectSelect.value;

    if (projectId === NEW_PROJECT_VALUE) {
      const name = newProjectInput.value.trim();
      if (!name) {
        setStatus('Enter a name for the new project', 'error');
        captureBtn.disabled = false;
        return;
      }
      const project = await api.createProject(name);
      projectId = project.id;
    }

    await api.captureItem(projectId, currentTab.url, currentTab.title);
    setStatus('Added to board ✓', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    captureBtn.disabled = false;
  }
});

init();
