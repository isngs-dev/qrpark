/**
 * Cookie names and options, on their own (pure: no `next/headers`).
 *
 * Adapted from eparking admin/lib/cookie-names.ts (359c0c1). Middleware imports
 * this file, and importing `session.ts` from there would drag `cookies()` in.
 *
 * Sprint 5b rules (review room): httpOnly, SameSite=Lax, path /, never a
 * Domain; Secure in production, where the names also carry the `__Host-`
 * prefix, which a browser only accepts on a Secure, Domain-less, path-/
 * cookie set by this exact host.
 */

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export function cookieNames(production: boolean) {
  const prefix = production ? '__Host-' : '';
  return {
    access: `${prefix}qp_access`,
    refresh: `${prefix}qp_refresh`,
    user: `${prefix}qp_user`,
  };
}

export function cookieOptions(production: boolean) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: production, path: '/' };
}

/**
 * Access tokens last 15 minutes. The cookie dies a minute earlier, so the
 * middleware sees it gone and refreshes before the backend would refuse it.
 */
export const ACCESS_MAX_AGE_SECONDS = 14 * 60;

/** Matches the backend's refresh token lifetime (7 days). */
export const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const COOKIES = cookieNames(IS_PRODUCTION);
export const COOKIE_OPTIONS = cookieOptions(IS_PRODUCTION);
