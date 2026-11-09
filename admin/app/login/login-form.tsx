'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type SignInState } from '@/lib/auth-actions';

/**
 * The sign-in form. Adapted from eparking admin/app/login/login-form.tsx
 * (359c0c1): a username instead of an email.
 *
 * It holds nothing: the credentials go to a Server Action (POST), and the
 * tokens come back as httpOnly cookies this code cannot read. The username is
 * kept across a refusal; the password is not.
 */
export function LoginForm() {
  const [state, action] = useActionState<SignInState, FormData>(signIn, {});
  const [username, setUsername] = useState('');

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-ink">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
