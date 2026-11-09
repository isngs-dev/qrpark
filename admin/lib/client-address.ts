import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * T13: the portal tells the backend which browser typed the password. Written
 * new. Server-only (Node crypto; read by the sign-in Server Action).
 *
 * The browser's address is the RIGHTMOST X-Forwarded-For entry: Render's proxy
 * appends the address it saw; anything to its left was sent by the client and
 * can be forged. The header the backend checks:
 *
 *   x-qrpark-client-address: <address>;<unix seconds>;<HMAC-SHA256 hex of "qrpark-login|address|seconds">
 *
 * keyed with QRPARK_CLIENT_ADDRESS_SECRET (32+ characters, shared with the
 * backend only, never NEXT_PUBLIC, never in the repo). No secret, or no usable
 * address: no header, and the backend counts the portal's own address as
 * before. The address is never logged.
 */

export const CLIENT_ADDRESS_HEADER = 'x-qrpark-client-address';
const MIN_SECRET_LENGTH = 32;

/** The browser's address from X-Forwarded-For: the rightmost entry, or null. */
export function browserAddress(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;
  const entries = forwardedFor.split(',');
  const last = entries[entries.length - 1].trim();
  return last.length <= 45 && isIP(last) !== 0 ? last : null;
}

export function signClientAddress(secret: string | undefined, address: string, nowSeconds: number): string | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const mac = createHmac('sha256', secret).update(`qrpark-login|${address}|${nowSeconds}`).digest('hex');
  return `${address};${nowSeconds};${mac}`;
}

/** The header for this sign-in (the browser's address from browserAddress), or none. */
export function clientAddressHeader(address: string | null): Record<string, string> {
  if (!address) return {};
  const value = signClientAddress(process.env.QRPARK_CLIENT_ADDRESS_SECRET, address, Math.floor(Date.now() / 1000));
  return value ? { [CLIENT_ADDRESS_HEADER]: value } : {};
}
