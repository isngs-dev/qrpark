/**
 * The backend's address: server-only.
 *
 * `QRPARK_API_URL` is infrastructure, so it is an environment variable, and it
 * is never a public (browser-exposed) variable: the browser never talks to the backend (the portal
 * calls it from the server), so the address need not reach the browser at all.
 * Read here and nowhere else (the source scan checks it).
 */
export function backendUrl(): string {
  return (process.env.QRPARK_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
