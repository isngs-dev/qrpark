import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireWithRetry,
  ACQUIRE_ATTEMPTS,
  isTransientLockFailure,
  lockUnavailableMessage,
} from './lock-retry';

/**
 * The lock that protects a customer's card.
 *
 * Copied from eparking backend/src/lock/lock-retry.test.ts unchanged; the
 * history below is eparking's.
 *
 * Two defects, one investigation.
 *
 * The message: withLock is a generic helper, and it threw "Payment locking is
 * unavailable. Refusing to charge without it" for every caller - including the
 * pass-entry path, which holds pass-entry:{siteId}:{passId} and charges
 * nothing. A gate operator whose barrier would not open was pointed at the
 * payment system. The ConflictException two lines below it is already
 * correctly generic, so the file disagreed with itself.
 *
 * The tolerance: enableOfflineQueue is false, so a command issued while the
 * socket is momentarily not writable throws instantly rather than waiting out
 * a reconnect that completes in milliseconds. Confirmed from the running
 * app's own log - "Stream isn't writeable and enableOfflineQueue options is
 * false" - and reproduced 5 times in 8 by severing the app's Redis
 * connections while the server itself stayed up and healthy.
 *
 * FAIL CLOSED IS NOT RELAXED. A genuinely unreachable Redis must still refuse
 * the charge; what changes is that a blip is no longer treated as an outage.
 */

const noSleep = async () => undefined;

// ---------------------------------------------------------------------------
// Which failures are worth another attempt
// ---------------------------------------------------------------------------

test('a socket that is not writable is transient', () => {
  // ioredis's exact wording, from the app's log.
  assert.equal(
    isTransientLockFailure(
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
    ),
    true,
  );
});

test('an interrupted or closed connection is transient', () => {
  for (const message of [
    'Connection is closed.',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:6379',
    'Reached the max retries per request limit',
  ]) {
    assert.equal(isTransientLockFailure(new Error(message)), true, message);
  }
});

test('an error that is not about the connection is not retried', () => {
  // Retrying a real fault would hide it and double whatever it did.
  assert.equal(isTransientLockFailure(new Error('ERR wrong number of arguments')), false);
  assert.equal(isTransientLockFailure(new Error('NOSCRIPT No matching script')), false);
  assert.equal(isTransientLockFailure('not an error at all'), false);
  assert.equal(isTransientLockFailure(undefined), false);
});

// ---------------------------------------------------------------------------
// The retry itself
// ---------------------------------------------------------------------------

test('a lock already held is refused at once, never retried', () => {
  // A null is a VERDICT, not a failure. Asking again immediately would only
  // collect a second refusal, and slow the counter down doing it.
  let calls = 0;
  return acquireWithRetry(async () => {
    calls += 1;
    return null;
  }, noSleep).then((result) => {
    assert.equal(result, null);
    assert.equal(calls, 1, 'a held lock must not be retried');
  });
});

test('a lock taken first time is taken once', async () => {
  let calls = 0;
  const token = await acquireWithRetry(async () => {
    calls += 1;
    return 'token';
  }, noSleep);

  assert.equal(token, 'token');
  assert.equal(calls, 1);
});

test('a blip is retried and succeeds', async () => {
  // THE bug: today this throws on the first attempt and the counter sees a
  // 503 while Redis is healthy.
  let calls = 0;
  const token = await acquireWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    }
    return 'token';
  }, noSleep);

  assert.equal(token, 'token');
  assert.equal(calls, 2, 'the second attempt is what makes a blip survivable');
});

test('a Redis that is genuinely down still fails, closed', async () => {
  // The property the whole lock exists for. A refused charge is retried in
  // seconds; a double charge is a refund and a dispute.
  let calls = 0;
  await assert.rejects(
    () =>
      acquireWithRetry(async () => {
        calls += 1;
        throw new Error('Connection is closed.');
      }, noSleep),
    /closed/i,
  );
  assert.ok(calls > 1, 'it should have tried more than once');
  assert.ok(calls <= ACQUIRE_ATTEMPTS, `attempts must be bounded, got ${calls}`);
});

test('the attempts are bounded', () => {
  // Bounded on purpose: a POS waiting on a hung lock is worse than a clear
  // error, which is what the original fail-fast choice was protecting.
  assert.ok(ACQUIRE_ATTEMPTS >= 2, 'one attempt is what the bug was');
  assert.ok(ACQUIRE_ATTEMPTS <= 3, 'this runs while somebody waits at a counter');
});

test('a non-transient failure is not retried', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      acquireWithRetry(async () => {
        calls += 1;
        throw new Error('ERR wrong number of arguments');
      }, noSleep),
    /wrong number of arguments/,
  );
  assert.equal(calls, 1, 'a real fault must surface, not be papered over');
});

// ---------------------------------------------------------------------------
// What the operator is told
// ---------------------------------------------------------------------------

test('the message does not mention charging unless the caller does', () => {
  const message = lockUnavailableMessage();
  assert.doesNotMatch(message, /charg/i, message);
  assert.doesNotMatch(message, /payment/i, message);
});

test('the caller can name what could not be done', () => {
  const message = lockUnavailableMessage('admit this vehicle');
  assert.match(message, /admit this vehicle/);
});

test('the message says nothing was changed', () => {
  // The operator's next question is always "did it half happen?". Both forms
  // have to answer it.
  assert.match(lockUnavailableMessage(), /nothing was changed/i);
  assert.match(lockUnavailableMessage('take this payment'), /nothing was changed/i);
});
