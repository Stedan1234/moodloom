import { useEffect, useState } from 'react';
import { api } from '../api';
import BoardItem from './BoardItem';
import Workspace from './Workspace';

// This is the actual core loop, in one screen: the fixed-grid reference board
// sitting side-by-side with the workspace, so opening a project means seeing
// everything relevant at once instead of hunting across apps first.
export default function ProjectView({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [manualUrl, setManualUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);

  async function refreshItems() {
    try {
      setItems(await api.listItems(projectId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    api.getProject(projectId).then(setProject).catch((err) => setError(err.message));
    refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleManualAdd(e) {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    setAdding(true);
    setNotice(null);
    try {
      const result = await api.captureItem(projectId, manualUrl.trim());
      setManualUrl('');
      // The backend de-dupes by URL and returns the existing item instead of
      // creating a second one — this just surfaces that to the person
      // instead of silently doing nothing (or, before this fix, silently
      // creating a duplicate).
      if (result.alreadyOnBoard) {
        setNotice('That reference is already on this board.');
      }
      await refreshItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(itemId) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await api.deleteItem(projectId, itemId);
    } catch (err) {
      setError(err.message);
      refreshItems(); // roll back the optimistic removal on failure
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 h-screen flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-700">
          ← Projects
        </button>
        <h1 className="text-lg font-semibold">{project?.name || '…'}</h1>
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded bg-gray-50 text-gray-600 text-sm px-3 py-2">{notice}</div>
      )}

      <div className="flex-1 grid grid-cols-[1fr_340px] gap-6 min-h-0">
        <div className="overflow-y-auto">
          {/* Manual-add fallback: the extension is the primary v1 capture path,
              but pasting a URL directly here means the board is still usable
              on a machine without the extension installed. */}
          <form onSubmit={handleManualAdd} className="flex gap-2 mb-4">
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="Paste a reference URL to add it manually"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={adding || !manualUrl.trim()}
              className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:bg-gray-300"
            >
              Add
            </button>
          </form>

          {items === null && <p className="text-gray-400 text-sm">Loading…</p>}
          {items?.length === 0 && (
            <p className="text-gray-400 text-sm">
              No references yet. Use the browser extension on any page, or paste a URL above.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {items?.map((item) => (
              <BoardItem key={item.id} item={item} onDelete={handleDelete} />
            ))}
          </div>
        </div>

        <Workspace projectId={projectId} />
      </div>
    </div>
  );
}
