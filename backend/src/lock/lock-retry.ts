/**
 * Taking a lock, and what to do when the attempt itself fails.
 *
 * Copied from eparking backend/src/lock/lock-retry.ts unchanged apart from
 * comments. M17 refers to eparking's docs/05-known-issues.md.
 *
 * Separate from LockService so the retry policy is testable without a Redis -
 * the same split the pricing and gate rules use, and the only kind of test
 * that can cover this reliably: an isolated ioredis script does NOT reproduce
 * the failure this exists for (see M17 in eparking's docs/05-known-issues.md).
 *
 * The bug this fixes: enableOfflineQueue is false, so a command issued while
 * the socket is momentarily not writable throws instantly rather than waiting
 * out a reconnect that completes in milliseconds. "Fail fast rather than
 * queueing forever behind a dead server" was the right instinct, but it was
 * implemented as "never wait at all", so a blip and an outage were treated
 * identically and a charge failed at the counter for no real reason.
 *
 * FAIL CLOSED IS NOT RELAXED. A genuinely unreachable Redis still refuses the
 * charge - a refused charge is retried in seconds, a double charge is a refund
 * and a dispute. What changes is only the tolerance, and it stays bounded:
 * somebody is standing at a counter while this runs.
 */

/**
 * Connection-level failures, which say nothing about whether the lock is free.
 *
 * Matched on the message because ioredis reports all of these as plain Errors
 * without a code. The first is the one seen in production logs; the rest are
 * the neighbouring ways the same socket dies.
 *
 * Anything else is a real fault and is deliberately NOT retried - retrying a
 * malformed command would hide it and double whatever it did.
 */
const TRANSIENT_PATTERNS = [
  // ioredis, when enableOfflineQueue is false and the socket is not ready.
  "stream isn't writeable",
  'connection is closed',
  'econnreset',
  'econnrefused',
  'epipe',
  'etimedout',
  'socket closed unexpectedly',
  'max retries per request',
];

/** A lock attempt that failed for a transport reason rather than a verdict. */
export function isTransientLockFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return TRANSIENT_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * The message shown when the lock cannot be taken at all.
 *
 * `withLock` is generic - it guards a payment on one path and a pass entry at
 * a barrier on another - so the sentence must not name a charge unless the
 * caller does. It used to say "Refusing to charge" to a gate operator whose
 * barrier would not open, sending them to look at the payment system.
 *
 * "Nothing was changed" is not padding: it answers the question an operator
 * always asks next, which is whether it half happened.
 */
export function lockUnavailableMessage(operation?: string): string {
  const what = operation?.trim();
  return what
    ? `Cannot ${what} right now - the system could not take the lock it needs ` +
        'to do it safely. Nothing was changed. Try again shortly.'
    : 'The system could not take the lock it needs to do this safely. ' +
        'Nothing was changed. Try again shortly.';
}

/**
 * How many times an acquisition is attempted before giving up.
 *
 * Two, not more. One was the bug; a long series would leave a POS waiting on a
 * hung lock, which is the thing the original fail-fast choice was protecting
 * against.
 */
export const ACQUIRE_ATTEMPTS = 2;

/** How long to wait between attempts - long enough for a reconnect, no more. */
export const ACQUIRE_RETRY_DELAY_MS = 120;

/**
 * Attempt to take a lock, retrying a transport failure a bounded number of
 * times.
 *
 * Returns the acquisition result - a token when taken, null when somebody else
 * holds it. A null is a VERDICT and is never retried: the lock is held, and
 * asking again immediately would only collect a second refusal while somebody
 * waits.
 *
 * Throws when every attempt failed, so the caller still fails CLOSED.
 */
export async function acquireWithRetry(
  tryAcquire: () => Promise<string | null>,
  sleep: (ms: number) => Promise<void>,
): Promise<string | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      return await tryAcquire();
    } catch (error) {
      // A real fault surfaces immediately; only the connection is worth
      // another go.
      if (!isTransientLockFailure(error)) throw error;

      lastError = error;
      if (attempt < ACQUIRE_ATTEMPTS) await sleep(ACQUIRE_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}
