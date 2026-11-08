import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth-context';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register({ email, username, displayName, password, message: note.trim() || undefined });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-purple-700 focus:ring-2 focus:ring-purple-200';

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f4ede4] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl text-white shadow-lg">💬</div>
          <h1 className="text-2xl font-bold tracking-tight">Team Chat</h1>
          <p className="mt-1 text-sm text-zinc-600">Where your team gets work done.</p>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>

          {mode === 'register' && (
            <>
              <label className="block text-sm font-medium text-zinc-700">
                Display name
                <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoComplete="name" />
              </label>
              <label className="mt-3 block text-sm font-medium text-zinc-700">
                Username
                <input
                  className={input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  pattern="[a-zA-Z0-9_.\-]{2,32}"
                  title="2-32 characters: letters, numbers, _ . -"
                  autoComplete="username"
                />
              </label>
            </>
          )}

          {mode === 'register' && (
            <label className="mt-3 block text-sm font-medium text-zinc-700">
              Who invited you? <span className="font-normal text-zinc-500">(optional)</span>
              <textarea
                className={`${input} resize-none`}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Part of the design team — Priya asked me to join"
              />
            </label>
          )}

          <label className="mt-3 block text-sm font-medium text-zinc-700">
            Email
            <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="mt-3 block text-sm font-medium text-zinc-700">
            Password
            <input
              className={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {mode === 'register' && (
            <p className="mt-3 text-xs text-zinc-500">
              Sign-ups are reviewed by a workspace admin. You can sign in right away — you'll get in as soon as your
              request is accepted.
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-md bg-accent py-2.5 text-sm font-bold text-white transition hover:bg-purple-900 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Request access'}
          </button>

          <p className="mt-4 text-center text-sm text-zinc-600">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="font-semibold text-purple-800 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
                setNote('');
              }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-zinc-500">
          Demo: alice@example.com / bob@example.com · password123
        </p>
      </div>
    </div>
  );
}
