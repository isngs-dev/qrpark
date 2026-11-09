import { csvBackendPath } from './reports-types.ts';

/**
 * The CSV download (Sprint 5c), as a plain function so its guards can be
 * tested without a server. Written new. `app/csv/[report]/route.ts` (GET only)
 * calls it with the session's access cookie.
 *
 *   - no admin cookie: 401, the backend is not called
 *   - only the four reports, only each report's parameters (csvBackendPath)
 *   - the backend's file passes through byte for byte, with its own
 *     Content-Type and Content-Disposition, plus Cache-Control no-store and
 *     X-Content-Type-Options nosniff; no other backend header passes
 *   - the backend's refusal is shown as written, with its status
 *   - nothing is logged
 */

const PLAIN = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const plain = (status: number, text: string) => new Response(text, { status, headers: PLAIN });

export async function csvResponse(
  report: string,
  search: URLSearchParams,
  accessCookie: string | undefined,
  fetchFn: typeof fetch,
  backend: string,
): Promise<Response> {
  if (!accessCookie) return plain(401, 'Your session has ended. Sign in again, then download the file.');

  const wanted = csvBackendPath(report, search);
  if ('error' in wanted) return plain(400, wanted.error);

  let answer: Response;
  try {
    answer = await fetchFn(`${backend}${wanted.path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessCookie}`, Accept: 'text/csv' },
      cache: 'no-store',
    });
  } catch {
    return plain(502, 'The backend could not be reached. No file was made.');
  }

  if (!answer.ok) return plain(answer.status, await refusal(answer));

  const type = answer.headers.get('content-type') ?? '';
  if (!type.startsWith('text/csv')) return plain(502, 'The backend did not send a CSV file.');

  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const disposition = answer.headers.get('content-disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  return new Response(await answer.arrayBuffer(), { status: 200, headers });
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
