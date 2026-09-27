import { useEffect, useState } from 'react';
import { api } from '../api';

// Every account starts anonymous with zero friction — but an anonymous
// account has NO recovery path if its token is ever lost: cleared browser
// storage, a new machine, a rotated JWT_SECRET. That's not hypothetical —
// it's exactly what happened during real-machine testing of this app. This
// banner is the fix: surface the risk and offer a one-step way out (add an
// email + password) before it costs someone their projects, rather than
// leaving it as a buried "claim" feature nobody finds until it's too late.
export default function SaveAccount() {
  const [checked, setChecked] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [mode, setMode] = useState(null); // null | 'claim' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    api
      .getMe()
      .then((me) => setClaimed(Boolean(me.email)))
      .catch(() => {
        // If this fails, stay quiet rather than blocking the rest of the
        // app — the prompt just won't show up this load.
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleClaim(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.claimAccount(email.trim(), password);
      setClaimed(true);
      setMode(null);
      setSuccess('Account saved — you can now log in from any browser with this email.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.login(email.trim(), password);
      // A full reload is the simplest correct way to make every already-open
      // component (project list, open project, etc.) re-fetch under the
      // account we just switched to, instead of trying to thread a refresh
      // through several components' state.
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (!checked || claimed) {
    return success ? (
      <p className="text-xs text-green-700 mb-4">{success}</p>
    ) : null;
  }

  if (!mode) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded p-4 mb-6">
        <p className="text-sm text-amber-900 mb-2">
          <strong>Your account isn't backed up.</strong> It's anonymous by default — if this
          browser's storage is ever cleared, there's no way to get your projects back.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setMode('claim')}
            className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded"
          >
            Save my account
          </button>
          <button
            onClick={() => setMode('login')}
            className="text-sm text-amber-900 underline"
          >
            I already have an account — log in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded p-4 mb-6 max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium">
          {mode === 'claim' ? 'Save your account' : 'Log in'}
        </h2>
        <button onClick={() => { setMode(null); setError(null); }} className="text-gray-400 text-xs">
          ✕
        </button>
      </div>

      <form onSubmit={mode === 'claim' ? handleClaim : handleLogin} className="space-y-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {mode === 'claim' && (
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        )}

        {error && <p className="text-red-600 text-xs">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded w-full disabled:bg-gray-300"
        >
          {submitting ? 'Please wait…' : mode === 'claim' ? 'Save account' : 'Log in'}
        </button>
      </form>

      {mode === 'login' && (
        <p className="text-xs text-gray-400 mt-2">
          Logging in switches this browser to that account — anything currently under this
          browser's anonymous account stays where it is, it just won't be the one you're viewing.
        </p>
      )}
    </div>
  );
}
