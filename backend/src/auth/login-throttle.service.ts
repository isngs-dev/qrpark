import { HttpException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';
import { RedisThrottleStore } from './login-throttle-redis';
import { MemoryThrottleStore, THROTTLE_MESSAGE, throttleKeys, type Reservation, type ThrottleKeys, type ThrottleStore } from './login-throttle';

/** 429 Too Many Requests; the controller adds Retry-After. */
export class SignInThrottledException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super({ statusCode: 429, message: THROTTLE_MESSAGE(retryAfterSeconds), error: 'Too Many Requests' }, 429);
  }
}

/** A Redis step that has not answered in this long counts as Redis being down. */
const REDIS_STEP_MS = 800;

/** After Redis fails, go straight to memory for this long before trying Redis again (no wait on every sign-in). */
const RETRY_REDIS_AFTER_MS = 30_000;

/**
 * The sign-in throttle (Hardening H1). Written new. Counts live in Redis; when
 * Redis cannot be reached the same rules run from this process's memory
 * (capped), and LOGIN_THROTTLE_DEGRADED is logged as an error: /health
 * already reports Redis "down". Not failing closed: that would lock every
 * account, admins included, out for the whole outage. Not failing open: that
 * would drop the protection exactly when nobody can watch it.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly memory = new MemoryThrottleStore();
  private redisStore?: RedisThrottleStore;
  private degradedSince = 0;
  private lastError = 0;

  constructor(private readonly redis: RedisService) {}

  /** Created on first use, like RedisService's connection: a late Redis must not stop the app starting. */
  private store(): RedisThrottleStore {
    this.redisStore ??= new RedisThrottleStore(this.redis.connection());
    return this.redisStore;
  }

  keys(siteId: string, username: string, address: string): ThrottleKeys {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return throttleKeys(secret, siteId, username, address);
  }

  reserve(keys: ThrottleKeys): Promise<Reservation> {
    return this.run((s) => s.reserve(keys));
  }

  settle(keys: ThrottleKeys, success: boolean): Promise<void> {
    return this.run((s) => s.settle(keys, success));
  }

  remainingSeconds(key: string): Promise<number> {
    return this.run((s) => s.remainingSeconds(key));
  }

  /** Clears a username's counts, in Redis and in the fallback (an admin reset its password). */
  async clearUser(siteId: string, username: string): Promise<void> {
    const { user } = this.keys(siteId, username, '-');
    await this.memory.clearUser(user);
    await this.run((s) => s.clearUser(user));
  }

  private async run<T>(step: (store: ThrottleStore) => Promise<T>): Promise<T> {
    if (this.degradedSince && Date.now() - this.degradedSince < RETRY_REDIS_AFTER_MS) return step(this.memory);
    try {
      const result = await Promise.race([
        step(this.store()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis did not answer')), REDIS_STEP_MS)),
      ]);
      if (this.degradedSince) {
        this.logger.log('LOGIN_THROTTLE_RESTORED - sign-in counts are in Redis again');
        this.degradedSince = 0;
      }
      return result;
    } catch (error) {
      // At most one error line a minute while Redis stays down.
      if (Date.now() - this.lastError > 60_000) {
        this.logger.error(`LOGIN_THROTTLE_DEGRADED - Redis unreachable, sign-in counts kept in memory: ${(error as Error).message}`);
        this.lastError = Date.now();
      }
      this.degradedSince = Date.now();
      return step(this.memory);
    }
  }
}
