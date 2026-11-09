import { NextResponse, type NextRequest } from 'next/server';
import { backendUrl } from './lib/backend-url';
import { ACCESS_MAX_AGE_SECONDS, COOKIES, COOKIE_OPTIONS, REFRESH_MAX_AGE_SECONDS } from './lib/cookie-names';
import { mayUsePortal } from './lib/users-types';

/**
 * Keeps the session cookies current, and sends a browser without a working
 * session to sign-in.
 *
 * Adapted from eparking admin/middleware.ts (359c0c1), which only checked that
 * a cookie was present. Here the middleware also REFRESHES: when the access
 * cookie has run out (it dies a minute before the 15-minute token) it spends
 * the refresh token once and writes the new pair, which a page render cannot.
 * A refused refresh clears every session cookie and goes to /login (Sprint 5b
 * rule); an unreachable backend keeps the session (the page says so). On /login itself a live session goes back to the portal, so a link to
 * /login from elsewhere cannot sign anybody out.
 *
 * Not the security boundary: every page gets its data from the backend, which
 * checks the token and the ADMIN role on every route.
 */
export const config = {
  runtime: 'nodejs',
  // Everything but Next's own assets, the favicon and the logo (the image
  // optimiser fetches the logo without cookies).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|gsd-logo.png).*)'],
};

export async function middleware(request: NextRequest) {
  const onLogin = request.nextUrl.pathname === '/login';
  const refresh = request.cookies.get(COOKIES.refresh)?.value;
  const access = request.cookies.get(COOKIES.access)?.value;

  if (!refresh) return onLogin ? NextResponse.next() : toLogin(request, false);
  if (access && !onLogin) return NextResponse.next();

  const pair = await refreshTokens(refresh);
  // Backend unreachable: keep the session; the page says the backend cannot be reached.
  if (pair === 'unreachable') return NextResponse.next();
  if (pair === 'refused' || !mayUsePortal(pair.user?.role)) return onLogin ? cleared(NextResponse.next()) : toLogin(request, true);

  // The page rendering now must see the new access token too.
  request.cookies.set(COOKIES.access, pair.accessToken);
  request.cookies.set(COOKIES.refresh, pair.refreshToken);
  const response = onLogin ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(COOKIES.access, pair.accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_MAX_AGE_SECONDS });
  response.cookies.set(COOKIES.refresh, pair.refreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_MAX_AGE_SECONDS });
  return response;
}

function toLogin(request: NextRequest, clear: boolean) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  return clear ? cleared(response) : response;
}

function cleared(response: NextResponse) {
  for (const name of Object.values(COOKIES)) response.cookies.set(name, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

type Pair = { accessToken: string; refreshToken: string; user?: { role?: string } };

async function refreshTokens(refreshToken: string): Promise<Pair | 'refused' | 'unreachable'> {
  try {
    const response = await fetch(`${backendUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (response.status >= 500) return 'unreachable';
    if (!response.ok) return 'refused';
    const body = (await response.json().catch(() => null)) as Partial<Pair> | null;
    return body?.accessToken && body.refreshToken ? { accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user } : 'refused';
  } catch {
    return 'unreachable';
  }
}
