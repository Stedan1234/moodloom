// Renders a single captured reference on the grid. Native rendering per
// mvp-scope.md: images and video play inline, not just a link-out — except
// the known v1 Instagram gap (see backend/src/services/mediaDetector.js),
// which falls back to a link-out card rather than failing.
export default function BoardItem({ item, onDelete }) {
  return (
    <div className="group relative border border-gray-200 rounded overflow-hidden bg-white">
      <button
        onClick={() => onDelete(item.id)}
        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove"
      >
        ✕
      </button>

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
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      )}

      {item.media_type === 'link' && (
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          className="aspect-video flex items-center justify-center bg-gray-50 text-sm text-gray-600 px-3 text-center break-all"
        >
          {item.title || item.source_url}
        </a>
      )}

      {item.title && item.media_type !== 'link' && (
        <div className="px-2 py-1.5 text-xs text-gray-600 truncate" title={item.title}>
          {item.title}
        </div>
      )}
    </div>
  );
}
