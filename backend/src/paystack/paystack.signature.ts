import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Paystack webhook signature.
 *
 * Paystack signs the raw request body with HMAC-SHA512 keyed on the secret
 * key, and sends the hex digest in the x-paystack-signature header. An
 * unsigned or wrongly-signed callback is discarded before any state change -
 * otherwise anyone who learns the webhook URL could have tickets issued.
 *
 * Pure function, no I/O, so it is exhaustively testable. See
 * paystack.signature.test.ts.
 *
 * Copied from eparking backend/src/paystack/paystack.signature.ts unchanged.
 */
export function isValidPaystackSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secretKey: string | undefined,
): boolean {
  if (!rawBody || !signature || !secretKey) return false;

  const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
