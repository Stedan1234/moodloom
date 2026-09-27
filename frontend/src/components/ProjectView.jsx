import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import BoardItem from './BoardItem';
import Workspace from './Workspace';

// How often to poll for new items while a project is open. This is what
// makes a capture from the extension show up without a manual refresh —
// there's no push/websocket layer yet, so this is a simple, safe stand-in:
// it only re-fetches the read-only board list, never touches the workspace
// notes (separate component, separate autosave), and there's no drag-to-
// reorder yet for a mid-poll update to disrupt.
const POLL_INTERVAL_MS = 4000;

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
  // Tracks items the user just deleted but whose DELETE request hasn't been
  // confirmed by the server yet — without this, a poll landing in that gap
  // would make a just-deleted item flicker back before the request completes.
  const pendingDeleteIds = useRef(new Set());

  async function refreshItems() {
    try {
      const fresh = await api.listItems(projectId);
      setItems(fresh.filter((item) => !pendingDeleteIds.current.has(item.id)));
    } catch (err) {
      setError(err.message);
    }
  }

  // Silent version for the polling loop: no error banner (a transient network
  // blip shouldn't interrupt someone mid-work), and only updates state if the
  // list actually changed, so a capture that just landed doesn't cause the
  // whole grid (including images already loaded) to visibly re-render.
  async function pollItems() {
    try {
      const fresh = await api.listItems(projectId);
      const filtered = fresh.filter((item) => !pendingDeleteIds.current.has(item.id));
      setItems((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(filtered)) return prev;
        return filtered;
      });
    } catch {
      // Stay quiet — this is a background convenience refresh, not a
      // user-initiated action, so it shouldn't surface errors.
    }
  }

  useEffect(() => {
    api.getProject(projectId).then(setProject).catch((err) => setError(err.message));
    refreshItems();

    const interval = setInterval(pollItems, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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
    pendingDeleteIds.current.add(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await api.deleteItem(projectId, itemId);
      pendingDeleteIds.current.delete(itemId);
    } catch (err) {
      // Clear the guard BEFORE refreshing, so the rollback actually gets to
      // bring the item back instead of the guard filtering it right back out.
      pendingDeleteIds.current.delete(itemId);
      setError(err.message);
      await refreshItems();
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
