/**
 * The email address a charge is attributed to.
 *
 * Copied from eparking backend/src/payments/payer-email.ts (same address).
 *
 * Customers are anonymous (docs/01-flow.md), but Paystack's API requires an
 * email on a charge. It is decided here rather than on the device, so every
 * anonymous payment carries the same value. An integration necessity, not an
 * operational setting.
 */

/**
 * What a walk-in customer's payment is attributed to.
 *
 * The domain must be a REAL, non-reserved one. An earlier version used
 * `eparking.local`, which is syntactically a valid address but sits under a
 * reserved special-use TLD (RFC 6762); Paystack's own validator rejected it
 * and every anonymous charge came back 502 "email must be a valid email".
 *
 * A unit test asserting the literal string could not catch that - it only
 * confirmed the constant equalled itself. The reserved-TLD test below is what
 * would have, and a live sandbox charge is what actually proved the fix.
 *
 * The domain is one this project owns. No mailbox exists at this address and
 * nothing is expected to arrive there, but Paystack can email a receipt to the
 * address on a charge, so it must not point at a domain belonging to someone
 * else.
 */
export const WALK_IN_EMAIL = 'walkin@gsds.com.ng';

/** The supplied address, or the walk-in fallback when there isn't one. */
export function payerEmail(supplied: string | null | undefined): string {
  const trimmed = supplied?.trim();
  return trimmed ? trimmed : WALK_IN_EMAIL;
}
