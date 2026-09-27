import { useState } from 'react';

// Raised during real dogfooding: once a project's board grows past a
// handful of items, "everything on one grid" stops being useful — this
// lets a project be split into groupings (Design Inspiration, Post Ideas,
// Video Direction, etc.) that can be switched between like tabs. Every
// project starts with a seeded starter set (see backend/routes/projects.js)
// but nothing here is fixed: rename, delete, or add more as the project's
// needs become clearer.
export default function CategoryTabs({
  categories,
  activeCategoryId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) {
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  async function submitNewCategory(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setAddingNew(false);
      return;
    }
    setNewName('');
    setAddingNew(false);
    await onCreate(name);
  }

  function startRename(category) {
    setRenamingId(category.id);
    setRenameValue(category.name);
  }

  async function submitRename(category) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === category.name) return;
    await onRename(category.id, name);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mb-3 border-b border-gray-200 pb-2">
      <button
        onClick={() => onSelect(null)}
        className={`text-sm px-3 py-1.5 rounded-full transition-colors ${
          activeCategoryId === null
            ? 'bg-gray-900 text-white'
            : 'text-gray-500 hover:bg-gray-100'
        }`}
      >
        All
      </button>

      {categories.map((category) => (
        <div key={category.id} className="group relative">
          {renamingId === category.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => submitRename(category)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="text-sm px-3 py-1.5 rounded-full border border-gray-300 w-32"
            />
          ) : (
            <button
              onClick={() => onSelect(category.id)}
              onDoubleClick={() => startRename(category)}
              title="Double-click to rename"
              className={`text-sm pl-3 pr-6 py-1.5 rounded-full transition-colors ${
                activeCategoryId === category.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {category.name}
            </button>
          )}
          {renamingId !== category.id && (
            <button
              onClick={() => onDelete(category.id)}
              title="Delete category (items become uncategorized)"
              className={`absolute top-1/2 -translate-y-1/2 right-1.5 w-4 h-4 rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${
                activeCategoryId === category.id ? 'text-white/70 hover:text-white' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {addingNew ? (
        <form onSubmit={submitNewCategory} className="inline-flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAddingNew(false);
                setNewName('');
              }
            }}
            placeholder="Category name"
            className="text-sm px-3 py-1.5 rounded-full border border-gray-300 w-32"
          />
          <button
            type="submit"
            className="text-sm px-3 py-1.5 rounded-full bg-gray-900 text-white disabled:bg-gray-300"
            disabled={!newName.trim()}
          >
            Add
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAddingNew(true)}
          className="text-sm px-3 py-1.5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          + New category
        </button>
      )}
    </div>
  );
}
