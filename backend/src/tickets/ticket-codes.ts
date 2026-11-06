import { randomBytes, randomInt } from 'node:crypto';

/**
 * The three identifiers a paid entry carries. Tested in ticket-codes.test.ts.
 *
 * TOKEN: the QR. 32 bytes from the operating system's CSPRNG (256 bits),
 * base64url without padding. Nothing else goes into it: no id, no time, no
 * reference, no amount. Never logged, never in an audit row. Adapted from the
 * opaque token in eparking backend/src/visits/visits.service.ts (24 bytes
 * there, as hex).
 *
 * TICKET NUMBER: for people. Short, random, from an alphabet without
 * look-alikes. Not a credential: it is never accepted in place of the QR.
 *
 * PAYMENT REFERENCE: ours, also given to Paystack. Random; no site code,
 * amount or sequence in it.
 */

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const TICKET_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TICKET_NUMBER_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
export const PAYMENT_REFERENCE_PATTERN = /^QRP_[0-9a-f]{24}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `pick` must be a cryptographic source in real use; randomInt is (and unbiased). */
export function newTicketNumber(pick: (max: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += TICKET_NUMBER_ALPHABET[pick(TICKET_NUMBER_ALPHABET.length)];
  }
  return out;
}

/** A typed or scanned ticket number, as stored; null when it cannot be one. */
export function normaliseTicketNumber(input: string): string | null {
  if (typeof input !== 'string') return null;
  // XXXX-XXXX or XXXXXXXX; a hyphen anywhere else is not a ticket number.
  const match = /^([A-Z0-9]{4})-?([A-Z0-9]{4})$/.exec(input.trim().toUpperCase());
  if (!match) return null;
  const formatted = `${match[1]}-${match[2]}`;
  return TICKET_NUMBER_PATTERN.test(formatted) ? formatted : null;
}

export function newPaymentReference(): string {
  return `QRP_${randomBytes(12).toString('hex')}`;
}
