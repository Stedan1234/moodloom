import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import BoardItem from './BoardItem';
import CategoryTabs from './CategoryTabs';
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [categories, setCategories] = useState([]);
  // null = "All" — the currently viewed tab, and also where a new capture
  // (URL or upload) lands, so adding something while a category tab is
  // active files it straight into that category instead of always dumping
  // into "Uncategorized".
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  // The paste listener below is attached once per project (not re-attached
  // on every category switch), so it can't just close over activeCategoryId
  // directly — that would freeze it at whatever tab was active when the
  // listener was first attached. A ref keeps it reading the CURRENT tab.
  const activeCategoryIdRef = useRef(null);
  useEffect(() => {
    activeCategoryIdRef.current = activeCategoryId;
  }, [activeCategoryId]);
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

  async function refreshCategories() {
    try {
      setCategories(await api.listCategories(projectId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    api.getProject(projectId).then(setProject).catch((err) => setError(err.message));
    refreshItems();
    refreshCategories();
    setActiveCategoryId(null);

    const interval = setInterval(pollItems, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleCreateCategory(name) {
    try {
      const category = await api.createCategory(projectId, name);
      setCategories((prev) => [...prev, category]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameCategory(categoryId, name) {
    try {
      const updated = await api.renameCategory(projectId, categoryId, name);
      setCategories((prev) => prev.map((c) => (c.id === categoryId ? updated : c)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteCategory(categoryId) {
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    if (activeCategoryId === categoryId) setActiveCategoryId(null);
    try {
      await api.deleteCategory(projectId, categoryId);
      // Items that were in this category are now uncategorized server-side
      // (ON DELETE SET NULL) — refresh so the board reflects that.
      await refreshItems();
    } catch (err) {
      setError(err.message);
      await refreshCategories();
    }
  }

  async function handleUploadFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      await api.uploadItem(projectId, file, activeCategoryIdRef.current);
      await refreshItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Screenshots almost never live as a saved file — the normal flow is
  // snip-to-clipboard, then paste. Listening on the whole board (rather than
  // requiring a specific input to be focused) means that flow just works the
  // moment someone's looking at this project, without an extra click first.
  // Guarded so a paste while actually typing in a text field (the URL box,
  // or a workspace note) isn't hijacked into an upload.
  useEffect(() => {
    function onPaste(e) {
      const target = e.target;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping) return;

      const imageItem = Array.from(e.clipboardData?.items || []).find((item) =>
        item.type.startsWith('image/')
      );
      if (!imageItem) return;

      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) handleUploadFile(file);
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleManualAdd(e) {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    setAdding(true);
    setNotice(null);
    try {
      const result = await api.captureItem(projectId, manualUrl.trim(), undefined, activeCategoryId);
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

  async function handleMoveItemCategory(itemId, categoryId) {
    // Optimistic — the select's own value already changed the instant the
    // person picked an option, so the board should reflect that immediately
    // rather than waiting on a round-trip.
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, category_id: categoryId } : i)));
    try {
      await api.setItemCategory(projectId, itemId, categoryId);
    } catch (err) {
      setError(err.message);
      await refreshItems();
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

  const visibleItems =
    activeCategoryId === null ? items || [] : (items || []).filter((item) => item.category_id === activeCategoryId);

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
          <form onSubmit={handleManualAdd} className="flex gap-2 mb-2">
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

          {/* Second way to capture something: a file already on disk, or —
              far more common for a screenshot — snip it and paste (Ctrl/Cmd+V)
              anywhere on this board; see the window "paste" listener above. */}
          <div className="flex items-center gap-2 mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                handleUploadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm text-gray-500 hover:text-gray-800 underline disabled:text-gray-300"
            >
              {uploading ? 'Uploading…' : 'Upload an image from your computer'}
            </button>
            <span className="text-xs text-gray-400">or paste a screenshot (Ctrl/Cmd+V)</span>
          </div>

          <CategoryTabs
            categories={categories}
            activeCategoryId={activeCategoryId}
            onSelect={setActiveCategoryId}
            onCreate={handleCreateCategory}
            onRename={handleRenameCategory}
            onDelete={handleDeleteCategory}
          />

          {items === null && <p className="text-gray-400 text-sm">Loading…</p>}
          {items?.length === 0 && (
            <p className="text-gray-400 text-sm">
              No references yet. Use the browser extension on any page, or paste a URL above.
            </p>
          )}
          {items?.length > 0 && visibleItems.length === 0 && (
            <p className="text-gray-400 text-sm">Nothing in this category yet.</p>
          )}

          {/* Bumped from 3 columns to 2 after real dogfooding feedback that
              references — especially whole-page captures — were too small to
              actually evaluate. Enlarging any item further is one click away
              via the ⤢ button (see BoardItem's lightbox). */}
          <div className="grid grid-cols-2 gap-4">
            {visibleItems.map((item) => (
              <BoardItem
                key={item.id}
                item={item}
                onDelete={handleDelete}
                categories={categories}
                onMoveCategory={handleMoveItemCategory}
              />
            ))}
          </div>
        </div>

        <Workspace projectId={projectId} />
      </div>
    </div>
  );
}
