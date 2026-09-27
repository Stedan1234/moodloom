import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// v1 workspace: plain text notes living next to the board (per mvp-scope.md —
// deliberately NOT a design canvas yet, just proving the side-by-side value).
export default function Workspace({ projectId }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | saved
  const debounceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getWorkspace(projectId).then((data) => {
      if (!cancelled) setContent(data.content);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function handleChange(e) {
    const value = e.target.value;
    setContent(value);
    setStatus('saving');

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await api.saveWorkspace(projectId, value);
      setStatus('saved');
    }, 600);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">Workspace</h2>
        <span className="text-xs text-gray-400">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder="Sketch out ideas, notes, or direction here — right next to your references."
        className="flex-1 w-full border border-gray-200 rounded p-3 text-sm resize-none focus:outline-none focus:border-gray-400"
      />
    </div>
  );
}
