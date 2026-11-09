/**
 * The backend's address: server-only. Plain JavaScript (not TypeScript) so
 * next.config.mjs can load it too: one rule, one place that reads the variable.
 *
 * `QRPARK_API_URL` is infrastructure, so it is an environment variable, and it
 * is never a public (browser-exposed) variable: the browser never talks to the
 * backend (the portal calls it from the server). Read here and nowhere else
 * (the source scan checks it).
 *
 * Hardening H3 (T12): in production it must be set and https, or the portal
 * refuses to start (next.config.mjs) and every backend call refuses too. The
 * localhost default is for development only. The refusal never repeats the
 * value, which could hold a password.
 */

const DEV_DEFAULT = 'http://localhost:3000';

/**
 * @param {string | undefined} value  the configured address
 * @param {boolean} production
 * @returns {string} the address without trailing slashes
 */
export function checkBackendUrl(value, production) {
  const raw = (value ?? '').trim();
  if (!production) return (raw || DEV_DEFAULT).replace(/\/+$/, '');
  if (!raw) throw new Error('QRPARK_API_URL must be set in production (an https:// address of the backend).');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('QRPARK_API_URL must be an https:// address in production; the value set is not an address.');
  }
  if (url.protocol !== 'https:') throw new Error('QRPARK_API_URL must be an https:// address in production.');
  if (url.username || url.password) throw new Error('QRPARK_API_URL must not hold a user name or password.');
  if (url.search || url.hash) throw new Error('QRPARK_API_URL must not have a query or fragment.');
  return raw.replace(/\/+$/, '');
}

/** For next.config.mjs at "next start": the production rule, whatever NODE_ENV says. */
export function requireProductionBackendUrl() {
  return checkBackendUrl(process.env.QRPARK_API_URL, true);
}

/** The configured backend address, checked (production: https or an error). */
export function backendUrl() {
  return checkBackendUrl(process.env.QRPARK_API_URL, process.env.NODE_ENV === 'production');
}
