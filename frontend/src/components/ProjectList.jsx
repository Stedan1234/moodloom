import { useEffect, useState } from 'react';
import { api } from '../api';
import ConnectExtension from './ConnectExtension';

export default function ProjectList({ onOpenProject }) {
  const [projects, setProjects] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject(newName.trim());
      setNewName('');
      await refresh();
      onOpenProject(project.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-1">Moodloom</h1>
      <p className="text-gray-500 mb-4">Your projects</p>

      <div className="mb-6">
        <ConnectExtension />
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2 mb-8">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:bg-gray-300"
        >
          Create
        </button>
      </form>

      {projects === null && <p className="text-gray-400 text-sm">Loading…</p>}

      {projects?.length === 0 && (
        <p className="text-gray-400 text-sm">
          No projects yet — create one above, or capture a reference with the browser
          extension and it'll show up here.
        </p>
      )}

      <div className="grid gap-2">
        {projects?.map((project) => (
          <button
            key={project.id}
            onClick={() => onOpenProject(project.id)}
            className="text-left border border-gray-200 rounded px-4 py-3 hover:border-gray-400 transition-colors"
          >
            <div className="font-medium">{project.name}</div>
            <div className="text-xs text-gray-400">
              Updated {new Date(project.updated_at).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
