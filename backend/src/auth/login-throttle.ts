import { createHmac } from 'node:crypto';

/**
 * The sign-in throttle's rules (Hardening H1, M1), and the in-memory store the
 * backend falls back to when Redis cannot be reached. Written new.
 *
 * Three counts of FAILED sign-ins, each in a 15-minute window from its first
 * failure (review decision):
 *   pair  username + address   5   one address cannot lock the account for everyone
 *   user  username, any address 20  a spread attack still stops
 *   ip    address, any username 30  one address spraying usernames stops
 * An attempt is refused (429) while any of its counts is at its limit, before
 * the password is checked, and even when the password is right. Nothing is
 * ever permanent: every count expires.
 *
 * Exact under concurrency: an attempt RESERVES one failure on each count when
 * it passes the check, atomically; a successful sign-in gives the reservation
 * back and clears the pair. So 50 parallel wrong passwords check exactly 5.
 *
 * Keys hold keyed hashes (HMAC-SHA256 with the server's secret) of the site and
 * the username or address, never the username or the address itself.
 */

export const LIMITS = { pair: 5, user: 20, ip: 30, windowSeconds: 900 } as const;

export type Scope = 'pair' | 'user' | 'ip';
export const SCOPES: Scope[] = ['pair', 'user', 'ip'];

/** The fallback store holds at most this many counts. */
export const MEMORY_CAP = 10_000;

export interface ThrottleKeys {
  pair: string;
  user: string;
  ip: string;
}

export type Reservation = { ok: true; reachedMax: Scope[] } | { ok: false; scope: Scope; retryAfterSeconds: number };

export interface ThrottleStore {
  /** Refuse if any count is at its limit; else reserve one failure on each. */
  reserve(keys: ThrottleKeys): Promise<Reservation>;
  /** Success: clear the pair and give back the username and address reservations. Failure: keep them. */
  settle(keys: ThrottleKeys, success: boolean): Promise<void>;
  /** Seconds left on a count (0 if none). */
  remainingSeconds(key: string): Promise<number>;
  /** Forget a username: its username count and every pair count. Returns the number removed. */
  clearUser(userKey: string): Promise<number>;
}

const normalise = (username: string) => username.trim().toLowerCase();
const hash = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex').slice(0, 32);

export function throttleKeys(secret: string, siteId: string, username: string, address: string): ThrottleKeys {
  const u = hash(secret, `${siteId}|user|${normalise(username)}`);
  const a = hash(secret, `${siteId}|ip|${address}`);
  return { pair: `qp:login:pair:${u}:${a}`, user: `qp:login:user:${u}`, ip: `qp:login:ip:${a}` };
}

/** The pair keys of a username start with this (so a reset can find them). */
export const pairPrefix = (userKey: string) => `qp:login:pair:${userKey.split(':')[3]}:`;

/** One message for every throttled sign-in: it names no username and says nothing about one. */
export function THROTTLE_MESSAGE(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * The fallback, used only while Redis cannot be reached. The same rules, in
 * this process's memory: exact for the single backend instance we run. Capped
 * at MEMORY_CAP counts (expired ones dropped first, then the oldest).
 */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.entries.get(key);
    if (e && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  async reserve(keys: ThrottleKeys): Promise<Reservation> {
    let blocked: { scope: Scope; ms: number } | null = null;
    for (const scope of SCOPES) {
      const e = this.live(keys[scope]);
      if (e && e.count >= LIMITS[scope]) {
        const ms = e.expiresAt - this.now();
        if (!blocked || ms > blocked.ms) blocked = { scope, ms };
      }
    }
    if (blocked) return { ok: false, scope: blocked.scope, retryAfterSeconds: Math.max(1, Math.ceil(blocked.ms / 1000)) };

    const reachedMax: Scope[] = [];
    for (const scope of SCOPES) {
      const e = this.live(keys[scope]);
      const next = e ? { count: e.count + 1, expiresAt: e.expiresAt } : { count: 1, expiresAt: this.now() + LIMITS.windowSeconds * 1000 };
      this.entries.delete(keys[scope]);
      this.entries.set(keys[scope], next);
      if (next.count === LIMITS[scope]) reachedMax.push(scope);
    }
    this.cap();
    return { ok: true, reachedMax };
  }

  async settle(keys: ThrottleKeys, success: boolean): Promise<void> {
    if (!success) return;
    this.entries.delete(keys.pair);
    for (const scope of ['user', 'ip'] as const) {
      const e = this.live(keys[scope]);
      if (e && e.count > 0) e.count -= 1;
    }
  }

  async remainingSeconds(key: string): Promise<number> {
    const e = this.live(key);
    return e ? Math.max(1, Math.ceil((e.expiresAt - this.now()) / 1000)) : 0;
  }

  async clearUser(userKey: string): Promise<number> {
    const prefix = pairPrefix(userKey);
    let removed = this.entries.delete(userKey) ? 1 : 0;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix) && this.entries.delete(key)) removed++;
    return removed;
  }

  counts(keys: ThrottleKeys): Record<Scope, number> {
    return { pair: this.live(keys.pair)?.count ?? 0, user: this.live(keys.user)?.count ?? 0, ip: this.live(keys.ip)?.count ?? 0 };
  }

  size(): number {
    return this.entries.size;
  }

  private cap() {
    if (this.entries.size <= MEMORY_CAP) return;
    const now = this.now();
    for (const [key, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MEMORY_CAP) break;
      this.entries.delete(key);
    }
  }
}
