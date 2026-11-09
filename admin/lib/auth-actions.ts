'use server';

import { redirect } from 'next/navigation';
import { login, logout } from './api';
import { clearSession, readSession, writeTokens, writeUser } from './session';
import { mayUsePortal } from './users-types';

/**
 * Sign in and sign out: Server Actions, so the credentials are posted to the
 * portal's server, the backend is called from there, and the tokens land in
 * httpOnly cookies the browser can send but not read.
 *
 * Adapted from eparking admin/lib/auth-actions.ts (359c0c1): username, ADMIN
 * only, and sign-out also ends the admin's sessions at the backend.
 */

export interface SignInState {
  error?: string;
}

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!username || !password) return { error: 'Enter a username and password.' };

  const result = await login(username, password);
  if (!result.ok) {
    // The backend says the same for an unknown user, a wrong password and an
    // inactive account; so does this.
    return { error: result.status === 401 ? 'Username or password not recognised.' : result.message };
  }

  const { accessToken, refreshToken, user, site } = result.data;
  if (!mayUsePortal(user.role)) {
    // A real operator account: nothing is stored, and the backend refuses every
    // admin route to it anyway.
    return { error: 'This portal is for administrators. Operator accounts sign in on the parking app.' };
  }

  await writeTokens(accessToken, refreshToken);
  await writeUser({ id: user.id, username: user.username, name: user.name, role: user.role, siteName: site.displayName });
  redirect('/');
}

export async function signOut(): Promise<void> {
  const { accessToken } = await readSession();
  await logout(accessToken);
  await clearSession();
  redirect('/login');
}
