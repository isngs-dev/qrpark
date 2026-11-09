import { redirect } from 'next/navigation';
import { backendUrl } from './backend-url.mjs';
import { clearSession, readSession, writeTokens } from './session';

/**
 * The only route from this portal to the backend. Runs on the server.
 *
 * Adapted from eparking admin/lib/api.ts (359c0c1):
 *   - the address is the server-only QRPARK_API_URL (backend-url.mjs; https in production, H3);
 *   - sign-in is by username;
 *   - a session the backend no longer accepts (refresh refused) is cleared and
 *     the admin is sent to sign-in, instead of returning an error to the page;
 *   - the "cannot reach" message no longer names the backend's address.
 *
 * It never calculates an amount and never sends a time. A 401 spends the
 * refresh token once, then gives up. Nothing here logs anything.
 */

const UNREACHABLE = 599;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export interface LoginAnswer {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; name: string; role: string };
  site: { code: string; displayName: string };
}

/** A call with the signed-in admin's token. Sends the browser to sign-in when the session has ended. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const { accessToken, refreshToken } = await readSession();
  if (!refreshToken) return ended();

  let response = await send(path, init, accessToken);
  if (response.status !== 401) return read<T>(response);

  // The middleware refreshes before an access token runs out; this covers a
  // token refused early. Only in a Server Action can the new pair be stored.
  const refreshed = await refreshTokens(refreshToken);
  if (!refreshed) return ended();
  await writeTokens(refreshed.accessToken, refreshed.refreshToken);

  response = await send(path, init, refreshed.accessToken);
  if (response.status === 401) return ended();
  return read<T>(response);
}

async function ended(): Promise<never> {
  await clearSession();
  redirect('/login');
}

/** Exchange a username and password for a token pair. Creates a session; never carries one. */
export async function login(username: string, password: string, clientHeader: Record<string, string> = {}): Promise<ApiResult<LoginAnswer>> {
  return read<LoginAnswer>(await send('/auth/login', { method: 'POST', body: { username, password }, headers: clientHeader }, undefined));
}

/** End every session of the signed-in admin at the backend (POST /auth/logout). */
export async function logout(accessToken: string | undefined): Promise<void> {
  if (accessToken) await send('/auth/logout', { method: 'POST' }, accessToken);
}

export async function refreshTokens(refreshToken: string): Promise<LoginAnswer | null> {
  const response = await send('/auth/refresh', { method: 'POST', body: { refreshToken } }, undefined);
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as LoginAnswer | null;
  return body?.accessToken && body.refreshToken ? body : null;
}

async function send(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> }, token: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(`${backendUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    return new Response(JSON.stringify({ message: 'The backend could not be reached.' }), {
      status: UNREACHABLE,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function read<T>(response: Response): Promise<ApiResult<T>> {
  const text = await response.text().catch(() => '');
  const body = text ? safeParse(text) : undefined;
  if (response.ok) return { ok: true, data: body as T };
  return { ok: false, status: response.status, message: messageFrom(body, response.status) };
}

/** NestJS sends `message` as a string or an array of strings. */
function messageFrom(body: unknown, status: number): string {
  const message = (body as { message?: unknown })?.message;
  if (Array.isArray(message)) return message.join('\n');
  if (typeof message === 'string' && message.trim()) return message;
  return status === UNREACHABLE ? 'The backend could not be reached.' : `Backend error (HTTP ${status}).`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
