import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { browserAddress, signClientAddress } from '../lib/client-address.ts';

/**
 * T13: the portal tells the backend which browser typed the password. The
 * browser's address is the RIGHTMOST X-Forwarded-For entry: the proxy in front
 * (Caddy) appends what it saw; anything to its left came from the client and can be
 * forged.
 */

test('the browser address is the rightmost X-Forwarded-For entry, never the leftmost', () => {
  assert.equal(browserAddress('203.0.113.9'), '203.0.113.9');
  assert.equal(browserAddress('6.6.6.6, 203.0.113.9'), '203.0.113.9', 'a forged left entry is ignored');
  assert.equal(browserAddress('1.1.1.1,2.2.2.2,   203.0.113.9  '), '203.0.113.9');
  assert.equal(browserAddress('2001:db8::7'), '2001:db8::7');
  assert.equal(browserAddress('6.6.6.6, 2001:db8::7'), '2001:db8::7');
});

test('no usable address: no header is sent (the backend uses its own view)', () => {
  for (const bad of [null, undefined, '', '   ', '203.0.113.9, ', 'not-an-address', '203.0.113.9; drop', '1'.repeat(60), '203.0.113.9 203.0.113.10']) {
    assert.equal(browserAddress(bad as string | null | undefined), null, JSON.stringify(bad));
  }
});

test('the signed header: address; unix seconds; HMAC-SHA256 of "qrpark-login|address|seconds"', () => {
  const secret = randomBytes(32).toString('hex');
  const value = signClientAddress(secret, '203.0.113.9', 1_800_000_000);
  const expected = createHmac('sha256', secret).update('qrpark-login|203.0.113.9|1800000000').digest('hex');
  assert.equal(value, `203.0.113.9;1800000000;${expected}`);
});

test('no secret (or a short one): nothing is signed', () => {
  assert.equal(signClientAddress(undefined, '203.0.113.9', 1_800_000_000), null);
  assert.equal(signClientAddress('', '203.0.113.9', 1_800_000_000), null);
  assert.equal(signClientAddress('x'.repeat(31), '203.0.113.9', 1_800_000_000), null);
});
