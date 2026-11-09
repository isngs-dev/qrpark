import { cookies } from 'next/headers';
import { ACCESS_MAX_AGE_SECONDS, COOKIES, COOKIE_OPTIONS, REFRESH_MAX_AGE_SECONDS } from './cookie-names';

/**
 * The portal's session, held in httpOnly cookies.
 *
 * Adapted from eparking admin/lib/session.ts (359c0c1): qrpark cookie names
 * (`__Host-` in production) and options from cookie-names.ts; usernames, not
 * emails; ADMIN only (users-types.ts `mayUsePortal`).
 *
 * Tokens never reach the browser's JavaScript. The portal calls the backend
 * from the server, reading these cookies there, so nothing token-shaped is
 * available to a script on the page. The browser never talks to the backend,
 * so no CORS opening is needed either.
 */

export interface PortalUser {
  id: string;
  username: string;
  name: string;
  role: string;
  /** The site's display name from the sign-in answer, for the header. */
  siteName: string;
}

export async function readSession(): Promise<{ accessToken?: string; refreshToken?: string; user?: PortalUser }> {
  const jar = await cookies();
  const rawUser = jar.get(COOKIES.user)?.value;
  return {
    accessToken: jar.get(COOKIES.access)?.value,
    refreshToken: jar.get(COOKIES.refresh)?.value,
    user: rawUser ? (safeParse(rawUser) as PortalUser | undefined) : undefined,
  };
}

/**
 * Store a fresh token pair. Next allows a cookie write only in a Server Action,
 * a Route Handler or middleware, so this reports whether the write happened.
 */
export async function writeTokens(accessToken: string, refreshToken: string): Promise<boolean> {
  try {
    const jar = await cookies();
    jar.set(COOKIES.access, accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_MAX_AGE_SECONDS });
    jar.set(COOKIES.refresh, refreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_MAX_AGE_SECONDS });
    return true;
  } catch {
    return false;
  }
}

/** Display only (who to greet). Nothing is authorised from it: the backend reads the token. */
export async function writeUser(user: PortalUser): Promise<void> {
  try {
    const jar = await cookies();
    jar.set(COOKIES.user, JSON.stringify(user), { ...COOKIE_OPTIONS, maxAge: REFRESH_MAX_AGE_SECONDS });
  } catch {
    // Render context: the header falls back to showing nothing.
  }
}

export async function clearSession(): Promise<void> {
  try {
    const jar = await cookies();
    for (const name of Object.values(COOKIES)) jar.set(name, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  } catch {
    // Render context: the middleware clears them on the way to /login.
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
