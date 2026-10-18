import { useEffect } from 'react';

// Full-screen viewer for board items with prev/next navigation, so going
// through a board's references doesn't mean closing and reopening each one.
// Arrow keys step, Escape closes. `items` is the already-filtered list (the
// active category tab), so navigation stays inside what's currently on screen.
export default function Lightbox({ items, index, onIndexChange, onClose }) {
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onIndexChange, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-label="Reference viewer"
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-2xl leading-none"
        title="Close (Esc)"
      >
        ✕
      </button>

      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl"
          title="Previous (←)"
          aria-label="Previous"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl"
          title="Next (→)"
          aria-label="Next"
        >
          ›
        </button>
      )}

      {item.media_type === 'video' && item.embed_html ? (
        <div
          key={item.id}
          className="w-full max-w-4xl aspect-video [&>iframe]:w-full [&>iframe]:h-full"
          onClick={(e) => e.stopPropagation()}
          // Built server-side from a regex-extracted YouTube id, never raw page HTML.
          dangerouslySetInnerHTML={{ __html: item.embed_html }}
        />
      ) : (
        <img
          key={item.id}
          src={item.thumbnail_url || item.source_url}
          alt={item.title || 'Captured reference'}
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 text-white text-sm bg-black/50 px-3 py-1 rounded">
        <span className="text-white/70">
          {index + 1} / {items.length}
        </span>
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline"
        >
          Open original
        </a>
      </div>
    </div>
  );
}
