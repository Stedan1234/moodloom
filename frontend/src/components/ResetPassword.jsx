import { useState } from 'react';
import { api } from '../api';

// Shown instead of the app when the page is opened from an emailed reset link
// (?reset_token=...). On success the new token is stored (api.resetPassword)
// and we navigate to the plain app URL, dropping the one-time token from the
// address bar and history.
export default function ResetPassword({ token }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      window.location.replace(window.location.pathname);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-24 p-4">
      <h1 className="text-lg font-medium mb-3">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded w-full disabled:bg-gray-300"
        >
          {submitting ? 'Please wait…' : 'Set password and log in'}
        </button>
      </form>
      <a href={window.location.pathname} className="text-xs text-gray-500 underline mt-3 inline-block">
        Back to Moodloom
      </a>
    </div>
  );
}
