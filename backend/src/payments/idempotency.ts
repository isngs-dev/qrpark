import { BadRequestException } from '@nestjs/common';

/**
 * A repeated "Take payment" for the same entry attempt carries the same key
 * and gets the same payment back. Tested in idempotency.test.ts.
 *
 * The key is unique across the whole payment table (payment_idempotency_key_key).
 * A key that another operator already used is refused (409) and never returns
 * that operator's payment. The same key with a different request is refused
 * too, so a reused key cannot silently mean something else.
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export type ReplayVerdict = 'SAME' | 'OTHER_OPERATOR' | 'DIFFERENT_REQUEST';

interface Attempt {
  operatorId: string;
  categoryCode: string;
  customerName: string | null;
}

export function replayVerdict(existing: Attempt, request: Attempt): ReplayVerdict {
  if (existing.operatorId !== request.operatorId) return 'OTHER_OPERATOR';
  if (existing.categoryCode !== request.categoryCode || existing.customerName !== request.customerName) {
    return 'DIFFERENT_REQUEST';
  }
  return 'SAME';
}

/** Optional (an open question in CLAUDE.md): trimmed, blank is none, at most 100. */
export function cleanCustomerName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const name = raw.trim();
  if (!name) return null;
  if (name.length > 100) throw new BadRequestException('Customer name must be at most 100 characters');
  return name;
}
