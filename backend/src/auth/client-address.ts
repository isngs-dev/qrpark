import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * T13: which browser typed the password, when the portal signs in for it.
 * Written new.
 *
 * The portal calls POST /auth/login from its own server, so the backend's own
 * view of the caller (req.ip) is the PORTAL's address. The portal therefore
 * sends the browser's address in a header:
 *
 *   x-qrpark-client-address: <address>;<unix seconds>;<HMAC-SHA256 hex of "qrpark-login|address|seconds">
 *
 * keyed with QRPARK_CLIENT_ADDRESS_SECRET, shared by the portal and the backend
 * only. The backend believes it ONLY on the sign-in route, ONLY when the secret
 * is configured (32+ characters), the signature matches (constant-time) and
 * the time is within 60 seconds of its own clock; anything else is ignored and
 * req.ip is used, as before. The address is only ever hashed into a throttle
 * key: never logged, never audited.
 */

export const CLIENT_ADDRESS_HEADER = 'x-qrpark-client-address';
export const MAX_SKEW_SECONDS = 60;
export const MIN_SECRET_LENGTH = 32;

export function verifyClientAddress(value: string | string[] | undefined, secret: string | undefined, nowSeconds: number): string | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (typeof value !== 'string' || value.length > 200) return null;
  const parts = value.split(';');
  if (parts.length !== 3) return null;
  const [address, ts, mac] = parts;
  if (address.length > 45 || isIP(address) === 0) return null;
  if (!/^\d{1,12}$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > MAX_SKEW_SECONDS) return null;
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;
  const expected = createHmac('sha256', secret).update(`qrpark-login|${address}|${ts}`).digest();
  const given = Buffer.from(mac, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? address : null;
}

/** The address the sign-in throttle counts: the verified browser address, else the backend's own view of the caller. */
export function clientAddressOf(req: Request): string {
  const verified = verifyClientAddress(req.headers[CLIENT_ADDRESS_HEADER], process.env.QRPARK_CLIENT_ADDRESS_SECRET, Math.floor(Date.now() / 1000));
  return verified ?? req.ip ?? '';
}
