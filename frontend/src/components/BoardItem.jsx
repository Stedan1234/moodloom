import { useState } from 'react';

// Renders a single captured reference on the grid. Native rendering per
// mvp-scope.md: images and video play inline, not just a link-out — except
// the known v1 Instagram gap (see backend/src/services/mediaDetector.js),
// which falls back to a link-out card rather than failing.
export default function BoardItem({ item, onDelete, categories, onMoveCategory }) {
  const [expanded, setExpanded] = useState(false);
  const hasVisual =
    (item.media_type === 'image' && (item.thumbnail_url || item.source_url)) ||
    (item.media_type === 'link' && item.thumbnail_url) ||
    (item.media_type === 'video' && item.embed_html);

  return (
    <>
      <div className="group relative border border-gray-200 rounded overflow-hidden bg-white">
        <button
          onClick={() => onDelete(item.id)}
          className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove"
        >
          ✕
        </button>

        {/* Recategorize without deleting and re-adding — raised during
            dogfooding: an item captured (or dropped) into the wrong category
            needs a way out that isn't "delete and recapture it". */}
        {categories?.length > 0 && (
          <select
            value={item.category_id ?? ''}
            onChange={(e) => onMoveCategory(item.id, e.target.value ? Number(e.target.value) : null)}
            onClick={(e) => e.stopPropagation()}
            title="Move to category"
            className="absolute bottom-1 right-1 z-10 max-w-[75%] text-[11px] rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity border-none px-1 py-0.5"
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}

        {hasVisual && (
          <button
            onClick={() => setExpanded(true)}
            className="absolute top-1 left-1 z-10 w-6 h-6 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            title="Enlarge"
          >
            ⤢
          </button>
        )}

        {item.media_type === 'video' && item.embed_html && (
          <div
            className="aspect-video [&>iframe]:w-full [&>iframe]:h-full"
            // embed_html is built server-side from a regex-extracted YouTube video
            // ID (see mediaDetector.js) — never raw captured page content — so
            // this isn't rendering arbitrary third-party HTML.
            dangerouslySetInnerHTML={{ __html: item.embed_html }}
          />
        )}

        {item.media_type === 'video' && !item.embed_html && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="aspect-video flex items-center justify-center bg-gray-100 text-sm text-gray-500 px-3 text-center"
          >
            Video reference — click to open
            <br />
            (inline preview not yet supported for this source)
          </a>
        )}

        {item.media_type === 'image' && (
          <img
            src={item.thumbnail_url || item.source_url}
            alt={item.title || 'Captured reference'}
            className="w-full aspect-video object-cover cursor-zoom-in"
            loading="lazy"
            onClick={() => setExpanded(true)}
          />
        )}

        {item.media_type === 'link' && item.thumbnail_url && (
          // The page's own social-preview image (og:image) — a real look at
          // the site, not just a text card. Falls back to the text card
          // below when a site has no og:image (fetch failed, blocked, or
          // the tag just isn't set).
          <a href={item.source_url} target="_blank" rel="noreferrer" className="block">
            <img
              src={item.thumbnail_url}
              alt={item.title || 'Captured reference'}
              className="w-full aspect-video object-cover"
              loading="lazy"
            />
          </a>
        )}

        {item.media_type === 'link' && !item.thumbnail_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="aspect-video flex items-center justify-center bg-gray-50 text-sm text-gray-600 px-3 text-center break-all"
          >
            {item.title || item.source_url}
          </a>
        )}

        {item.title && (
          <div className="px-2 py-1.5 text-xs text-gray-600 truncate" title={item.title}>
            {item.title}
          </div>
        )}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setExpanded(false)}
        >
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 text-white text-2xl leading-none"
            title="Close"
          >
            ✕
          </button>

          {item.media_type === 'video' && item.embed_html ? (
            <div
              className="w-full max-w-4xl aspect-video [&>iframe]:w-full [&>iframe]:h-full"
              onClick={(e) => e.stopPropagation()}
              dangerouslySetInnerHTML={{ __html: item.embed_html }}
            />
          ) : (
            <img
              src={item.thumbnail_url || item.source_url}
              alt={item.title || 'Captured reference'}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}

          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm underline bg-black/50 px-3 py-1 rounded"
          >
            Open original
          </a>
        </div>
      )}
    </>
  );
}
