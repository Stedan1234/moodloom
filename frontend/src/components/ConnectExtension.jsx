import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// Shows a short-lived pairing code the user types once into the extension.
// This replaces the earlier "both sides silently create their own anonymous
// account" behavior, which meant a capture in the extension never showed up
// here unless someone manually copied a token between the two (found and
// fixed after real-machine testing — see mvp-scope.md, Known Issues).
export default function ConnectExtension() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  async function generate() {
    setError(null);
    try {
      const result = await api.getPairingCode();
      setCode(result.code);
      const msLeft = new Date(result.expiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.round(msLeft / 1000)));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!open) return;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!code) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [code]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-gray-700 underline"
      >
        Connect browser extension
      </button>
    );
  }

  return (
    <div className="border border-gray-200 rounded p-4 mb-6 max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium">Connect the extension</h2>
        <button onClick={() => setOpen(false)} className="text-gray-400 text-xs">
          ✕
        </button>
      </div>

      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      {code && secondsLeft > 0 ? (
        <>
          <p className="text-xs text-gray-500 mb-2">
            Open the Moodloom extension, enter this code, and it'll capture into
            this same account:
          </p>
          <div className="text-2xl font-mono tracking-widest text-center bg-gray-50 rounded py-3 mb-2">
            {code}
          </div>
          <p className="text-xs text-gray-400 text-center">
            Expires in {secondsLeft}s
          </p>
        </>
      ) : (
        <button
          onClick={generate}
          className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded w-full"
        >
          {code ? 'Generate a new code' : 'Generate code'}
        </button>
      )}
    </div>
  );
}
