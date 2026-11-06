/**
 * Pure Paystack decisions, tested in verdicts.test.ts. No I/O.
 *
 * The window rule is adapted from eparking backend/src/paystack/abandoned.ts:
 * Paystack's verify says "abandoned" for a checkout the customer has not
 * FINISHED, including while they are still on the page, so "abandoned" alone
 * never ends a payment. Only the site's payment window does, counted from the
 * payment's own created_at (backend time) with the same strict comparison
 * everywhere.
 */

/** True when the payment is strictly older than the window. A future date is never old. */
export function windowExpired(createdAt: Date, now: Date, windowMinutes: number): boolean {
  const cutoff = now.getTime() - windowMinutes * 60_000;
  return createdAt.getTime() < cutoff;
}

/**
 * Paystack must report exactly our amount, as integer kobo, in NGN, before a
 * payment can become SUCCESS. A mismatch issues no ticket.
 */
export function amountMatches(payment: { amountKobo: number }, payload: Record<string, unknown>): boolean {
  return (
    typeof payload.amount === 'number' &&
    Number.isInteger(payload.amount) &&
    payload.amount === payment.amountKobo &&
    payload.currency === 'NGN'
  );
}

export type PaystackMode = 'test' | 'not configured';

/** For the Admin Portal, read-only. A live key never gets this far: see assertNotLiveKey. */
export function paystackMode(secretKey: string | undefined): PaystackMode {
  return secretKey && secretKey.trim().startsWith('sk_test_') ? 'test' : 'not configured';
}

/**
 * Test keys only until go-live is approved (CLAUDE.md). The backend refuses
 * to start with a live key rather than take real money by accident.
 */
export function assertNotLiveKey(secretKey: string | undefined): void {
  if (secretKey && secretKey.trim().startsWith('sk_live_')) {
    throw new Error(
      'PAYSTACK_SECRET_KEY is a LIVE key. Only test keys are allowed until go-live is approved.',
    );
  }
}

/** Paystack's own paid time from its payload. Stored for reconciliation; never used for validity. */
export function paystackPaidAt(payload: Record<string, unknown>): Date | null {
  const raw = payload.paid_at ?? payload.paidAt;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
