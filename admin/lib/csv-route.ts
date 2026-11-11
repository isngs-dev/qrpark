import { REPORTS, csvBackendPath } from './reports-types.ts';

/**
 * The CSV download (Sprint 5c), as a plain function so its guards can be
 * tested without a server. Written new. `app/csv/[report]/route.ts` (GET only)
 * calls it with the session's access cookie.
 *
 *   - no admin cookie: 401, the backend is not called
 *   - only the four reports, only each report's parameters (csvBackendPath)
 *   - the backend's file passes through byte for byte, AS A STREAM
 *     (Hardening H5: a file of a year or more is never held whole here; if
 *     the backend's stream breaks, the download breaks too, never a short
 *     file), with its own Content-Type and Content-Disposition, plus
 *     Cache-Control no-store and X-Content-Type-Options nosniff; no other
 *     backend header passes
 *   - every refusal (Hardening H4) is a small portal-styled page with the
 *     backend's words as written (HTML-escaped), a "Back to the report" link
 *     carrying only that report's own filters, the same status, no-store and
 *     nosniff
 *   - nothing is logged
 */

export async function csvResponse(
  report: string,
  search: URLSearchParams,
  accessCookie: string | undefined,
  fetchFn: typeof fetch,
  backend: string,
): Promise<Response> {
  const refuse = (status: number, message: string) => refusalPage(status, message, report, search);
  if (!accessCookie) return refuse(401, 'Your session has ended. Sign in again, then download the file.');

  const wanted = csvBackendPath(report, search);
  if ('error' in wanted) return refuse(400, wanted.error);

  let answer: Response;
  try {
    answer = await fetchFn(`${backend}${wanted.path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessCookie}`, Accept: 'text/csv' },
      cache: 'no-store',
    });
  } catch {
    return refuse(502, 'The backend could not be reached. No file was made.');
  }

  if (!answer.ok) return refuse(answer.status, await refusal(answer));

  const type = answer.headers.get('content-type') ?? '';
  if (!type.startsWith('text/csv')) return refuse(502, 'The backend did not send a CSV file.');

  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const disposition = answer.headers.get('content-disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  return new Response(answer.body, { status: 200, headers });
}

/** The backend's own words (Nest's `message`), else a plain sentence. */
async function refusal(answer: Response): Promise<string> {
  const text = await answer.text().catch(() => '');
  try {
    const message = (JSON.parse(text) as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // not JSON
  }
  return `The backend refused the download (HTTP ${answer.status}).`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Back to the report the download came from, with that report's own filters only; else the dashboard. */
function backLink(report: string, search: URLSearchParams): string {
  const spec = Object.prototype.hasOwnProperty.call(REPORTS, report) ? REPORTS[report as keyof typeof REPORTS] : undefined;
  if (!spec || !spec.csv) return '/';
  const q = new URLSearchParams();
  for (const name of spec.params) {
    const v = search.get(name);
    if (v) q.set(name, v);
  }
  const query = q.toString();
  return query ? `/${report}?${query}` : `/${report}`;
}

/** Hardening H4: a refused download as a small page in the portal's colours. */
export function refusalPage(status: number, message: string, report: string, search: URLSearchParams): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Download refused · QR Parking Admin</title>
<style>
  :root { color-scheme: light; --ink: #171b24; --soft: #565f70; --paper: #f4f6f9; --surface: #fff; --line: #dde2ea; --bad: #b8402f; --bad-wash: #fbe8e4; --accent: #0e6b77; }
  @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ink: #edeef2; --soft: #9aa3b5; --paper: #12151c; --surface: #1a1e28; --line: #2b303d; --bad: #e2796a; --bad-wash: #3a2220; --accent: #5cc6d1; } }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.5 system-ui, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 34rem; margin: 12vh auto; padding: 0 1.25rem; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem 1.5rem; }
  h1 { margin: 0 0 .75rem; font-size: 1.15rem; }
  .message { margin: 0 0 1rem; padding: .6rem .8rem; border-radius: 6px; background: var(--bad-wash); color: var(--bad); white-space: pre-line; }
  .note { margin: 0 0 1rem; color: var(--soft); font-size: 12.5px; }
  a { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>The file could not be made</h1>
    <p class="message">${escapeHtml(message)}</p>
    <p class="note">A CSV covers at most 92 days (about three months) and 1,048,575 rows (the most Excel can open); for more, download a shorter range. Nothing was changed.</p>
    <a href="${escapeHtml(backLink(report, search))}">Back to the report</a>
  </div>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
