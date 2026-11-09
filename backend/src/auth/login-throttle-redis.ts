import type Redis from 'ioredis';
import { LIMITS, SCOPES, pairPrefix, type Reservation, type ThrottleKeys, type ThrottleStore } from './login-throttle';

/**
 * The sign-in throttle's counts in Redis (Hardening H1). Written new.
 * Each step is one Lua script, so it is atomic across every backend process:
 * check-and-reserve cannot be raced by parallel attempts. Every key is given
 * the 15-minute TTL when created and keeps it; a key without a TTL is given
 * one (it cannot outlive the window).
 */

const RESERVE = `
local blocked, wait = 0, -1
for i = 1, 3 do
  local c = tonumber(redis.call('GET', KEYS[i]) or '0')
  if c >= tonumber(ARGV[i]) then
    local t = redis.call('PTTL', KEYS[i])
    if t > wait then wait = t; blocked = i end
  end
end
if blocked > 0 then return {0, blocked, wait} end
local reached = {1, 0, 0, 0}
for i = 1, 3 do
  local c = redis.call('INCR', KEYS[i])
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], ARGV[4]) end
  if c == tonumber(ARGV[i]) then reached[i + 1] = 1 end
end
return reached
`;

const SETTLE_SUCCESS = `
redis.call('DEL', KEYS[1])
for i = 2, 3 do
  local c = tonumber(redis.call('GET', KEYS[i]) or '0')
  if c > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
`;

export class RedisThrottleStore implements ThrottleStore {
  constructor(private readonly redis: Redis) {}

  async reserve(keys: ThrottleKeys): Promise<Reservation> {
    const r = (await this.redis.eval(RESERVE, 3, keys.pair, keys.user, keys.ip, LIMITS.pair, LIMITS.user, LIMITS.ip, LIMITS.windowSeconds * 1000)) as number[];
    if (r[0] === 0) return { ok: false, scope: SCOPES[r[1] - 1], retryAfterSeconds: Math.max(1, Math.ceil(Number(r[2]) / 1000)) };
    return { ok: true, reachedMax: SCOPES.filter((_, i) => r[i + 1] === 1) };
  }

  async settle(keys: ThrottleKeys, success: boolean): Promise<void> {
    if (success) await this.redis.eval(SETTLE_SUCCESS, 3, keys.pair, keys.user, keys.ip);
  }

  async remainingSeconds(key: string): Promise<number> {
    const ms = await this.redis.pttl(key);
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  async clearUser(userKey: string): Promise<number> {
    let removed = await this.redis.del(userKey);
    let cursor = '0';
    do {
      const [next, found] = await this.redis.scan(cursor, 'MATCH', `${pairPrefix(userKey)}*`, 'COUNT', 200);
      if (found.length) removed += await this.redis.del(...found);
      cursor = next;
    } while (cursor !== '0');
    return removed;
  }
}
