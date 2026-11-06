import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import {
  acquireWithRetry,
  isTransientLockFailure,
  lockUnavailableMessage,
} from './lock-retry';

/**
 * Copied from eparking backend/src/lock/lock.service.ts. Changed: this
 * comment, the local Redis port, the conflict message, and onModuleDestroy.
 *
 * A distributed lock for the rule a read-then-write check cannot defend,
 * because the race happens before the write: one payment in progress per
 * operator (key payment:operator:<id>).
 *
 * What this adds over the database: payment_one_pending_per_operator stops
 * the LEDGER holding two PENDING payments for one operator. It cannot stop
 * two requests both DECIDING to charge and both reaching Paystack before the
 * second insert fails. The constraint protects the record. The lock protects
 * the card.
 *
 * FAIL CLOSED. If Redis is unreachable we refuse to start a charge rather
 * than proceed unlocked: a refused charge is retried in seconds, a double
 * charge is a refund and a dispute. This lock is never applied to exit
 * validation (Sprint 3), so a vehicle that has paid can still leave during a
 * Redis outage.
 */
@Injectable()
export class LockService implements OnModuleDestroy {
  private readonly logger = new Logger(LockService.name);
  private client: Redis | null = null;

  private redis(): Redis {
    if (this.client === null) {
      this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
        // Fail fast rather than queueing forever behind a dead server: a POS
        // waiting on a hung lock is worse than a clear error.
        //
        // KEPT ON PURPOSE. Turning this on with a bounded commandTimeout was
        // considered and declined: the blip it would absorb is already
        // absorbed by acquireWithRetry, so the change would buy nothing while
        // altering the file that stops a card being charged twice.
        //
        // If you do revisit it, DO NOT trust an isolated ioredis script - one
        // showed 0 failures in 240 attempts while the app was failing 5 in 8,
        // because a standalone client reconnects before the next command
        // lands. Only the app-level harness reproduces it: sever the app's
        // connections with `redis-cli CLIENT KILL TYPE normal`, then charge,
        // x8. See M17 in eparking's docs/05-known-issues.md.
        enableOfflineQueue: false,
      });
      this.client.on('error', (error) => {
        this.logger.error(`REDIS_UNAVAILABLE - ${error.message}`);
      });
    }
    return this.client;
  }

  /** Reported on /health so a Redis outage is visible, not silent. */
  async isReachable(): Promise<boolean> {
    try {
      return (await this.redis().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Run `work` while holding `key`, or refuse.
   *
   * Throws ConflictException when someone else holds it, and
   * ServiceUnavailableException when Redis itself cannot be reached.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    work: () => Promise<T>,
    /**
     * What the caller is doing, for the message when the lock cannot be taken.
     * A short verb phrase: "take this payment", "admit this vehicle".
     */
    operation?: string,
  ): Promise<T> {
    const fullKey = `lock:${key}`;
    const token = randomBytes(16).toString('hex');

    let acquired: string | null;
    try {
      // Retried once on a transport failure. The socket being momentarily not
      // writable - during a reconnect that completes in milliseconds - is not
      // an outage, and used to fail a charge at the counter as though it were.
      acquired = await acquireWithRetry(
        () => this.redis().set(fullKey, token, 'PX', ttlMs, 'NX'),
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
    } catch (error) {
      // The visible alert: an error-level log with a greppable code, plus the
      // degraded flag on /health. Sprint 15 wires these to real monitoring.
      // Transient is still logged - it is how a flapping connection is seen
      // at all - but marked, so a blip is not read as an outage.
      this.logger.error(
        `REDIS_LOCK_UNAVAILABLE${isTransientLockFailure(error) ? ' (transient)' : ''} - ` +
          `refusing to proceed without lock "${fullKey}": ${(error as Error).message}`,
      );
      // Still fails CLOSED. A refused charge is retried in seconds; a double
      // charge is a refund and a dispute.
      throw new ServiceUnavailableException(lockUnavailableMessage(operation));
    }

    if (acquired === null) {
      throw new ConflictException('This is already being handled. Try again in a moment.');
    }

    try {
      return await work();
    } finally {
      await this.release(fullKey, token);
    }
  }

  /**
   * Compare-and-delete, so a slow holder whose lock already expired cannot
   * delete the lock somebody else has since acquired.
   */
  private async release(fullKey: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    try {
      await this.redis().eval(script, 1, fullKey, token);
    } catch (error) {
      // Not fatal: the TTL will clear it. Still worth surfacing.
      this.logger.error(`REDIS_LOCK_RELEASE_FAILED "${fullKey}": ${(error as Error).message}`);
    }
  }

  /**
   * Changed from eparking: quit() only when connected. With Redis down, quit()
   * is refused (offline queue off) and the client went on reconnecting
   * forever, so the process never exited on shutdown.
   */
  async onModuleDestroy() {
    if (!this.client) return;
    if (this.client.status === 'ready') await this.client.quit().catch(() => undefined);
    else this.client.disconnect();
    this.client = null;
  }
}
