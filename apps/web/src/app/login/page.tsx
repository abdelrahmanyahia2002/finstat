'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useSession } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { Alert, Button, Input } from '@/components/ui';

export default function LoginPage() {
  const { user, loading, signIn, register } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === 'signIn') await signIn(email, password);
      else await register(name, email, password);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not reach the server. Is the API running?',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-ink-800 text-lg font-semibold text-white">
            F
          </div>
          <h1 className="text-lg font-semibold text-ink-900">FinStat</h1>
          <p className="mt-1 text-sm text-ink-500">
            Annual financial statements, from the trial balance up.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-lg border border-ink-200 bg-white p-6 shadow-sm">
          {error ? <Alert tone="bad">{error}</Alert> : null}

          {mode === 'register' ? (
            <Input
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          ) : null}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            hint={mode === 'register' ? 'At least 10 characters.' : undefined}
            required
          />

          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {mode === 'signIn' ? 'Sign in' : 'Create account'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signIn' ? 'register' : 'signIn');
              setError(null);
            }}
            className="w-full pt-1 text-center text-xs text-ink-500 hover:text-ink-800"
          >
            {mode === 'signIn'
              ? 'No account yet? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-400">
          Seeded install? Sign in with admin@finstat.local and Admin123!
        </p>
      </div>
    </main>
  );
}
