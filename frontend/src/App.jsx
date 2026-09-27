import { useEffect, useState } from 'react';
import ProjectList from './components/ProjectList';
import ProjectView from './components/ProjectView';

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('project') || null;
}

// Two views, reflected in the URL (?project=<id>) rather than kept only in
// React state — a reload, a bookmark, or sharing a link should land back on
// the same project, not drop to the project list. No router dependency
// needed at this scope; the History API alone covers it.
export default function App() {
  const [openProjectId, setOpenProjectId] = useState(getProjectIdFromUrl);

  useEffect(() => {
    function handlePopState() {
      setOpenProjectId(getProjectIdFromUrl());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function openProject(id) {
    window.history.pushState({}, '', `?project=${id}`);
    setOpenProjectId(id);
  }

  function backToList() {
    window.history.pushState({}, '', window.location.pathname);
    setOpenProjectId(null);
  }

  if (openProjectId) {
    return <ProjectView projectId={openProjectId} onBack={backToList} />;
  }
  return <ProjectList onOpenProject={openProject} />;
}
