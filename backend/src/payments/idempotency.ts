/**
 * A repeated tap for the same attempt carries the same key and gets the same
 * result back: the same ticket at entry, the same payment at the booth.
 * Tested in idempotency.test.ts.
 *
 * Keys are unique per table (ticket_idempotency_key_key,
 * payment_idempotency_key_key). A key another operator already used is
 * refused (409) and never returns that operator's row. The same key for a
 * different request is refused too, so a reused key cannot silently mean
 * something else.
 *
 * `subject` is what the request is about: the category code at entry; the
 * ticket id and the method (CASH or CARD) at the booth.
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export type ReplayVerdict = 'SAME' | 'OTHER_OPERATOR' | 'DIFFERENT_REQUEST';

interface Attempt {
  operatorId: string;
  subject: string;
}

export function replayVerdict(existing: Attempt, request: Attempt): ReplayVerdict {
  if (existing.operatorId !== request.operatorId) return 'OTHER_OPERATOR';
  if (existing.subject !== request.subject) return 'DIFFERENT_REQUEST';
  return 'SAME';
}
