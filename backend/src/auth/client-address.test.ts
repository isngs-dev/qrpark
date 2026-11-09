import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_ADDRESS_HEADER, MAX_SKEW_SECONDS, MIN_SECRET_LENGTH, verifyClientAddress } from './client-address';

/**
 * T13: the portal tells the backend the browser's address in a signed header.
 * The backend believes it only when it verifies; everything else is ignored.
 * The signature is computed here independently, so this test pins the format.
 */

const SECRET = randomBytes(32).toString('hex');
const NOW = 1_800_000_000;
const sign = (secret: string, address: string, ts: number) => createHmac('sha256', secret).update(`qrpark-login|${address}|${ts}`).digest('hex');
const header = (address: string, ts = NOW, secret = SECRET) => `${address};${ts};${sign(secret, address, ts)}`;

test('the header name, the 60-second window and the 32-character minimum', () => {
  assert.equal(CLIENT_ADDRESS_HEADER, 'x-qrpark-client-address');
  assert.equal(MAX_SKEW_SECONDS, 60);
  assert.equal(MIN_SECRET_LENGTH, 32);
});

test('a valid header gives the browser\'s address (IPv4 and IPv6)', () => {
  assert.equal(verifyClientAddress(header('203.0.113.9'), SECRET, NOW), '203.0.113.9');
  assert.equal(verifyClientAddress(header('2001:db8::7'), SECRET, NOW), '2001:db8::7');
  assert.equal(verifyClientAddress(header('203.0.113.9', NOW - 60), SECRET, NOW), '203.0.113.9');
  assert.equal(verifyClientAddress(header('203.0.113.9', NOW + 60), SECRET, NOW), '203.0.113.9');
});

test('missing, forged, expired, wrong-secret and tampered headers are ignored', () => {
  const good = header('203.0.113.9');
  const [, ts, mac] = good.split(';');
  const cases: Record<string, string | undefined> = {
    missing: undefined,
    empty: '',
    forged: `203.0.113.9;${NOW};${'0'.repeat(64)}`,
    'expired (61 s old)': header('203.0.113.9', NOW - 61),
    'from the future (61 s)': header('203.0.113.9', NOW + 61),
    'wrong secret': header('203.0.113.9', NOW, randomBytes(32).toString('hex')),
    'tampered address': `198.51.100.1;${ts};${mac}`,
    'tampered time': `203.0.113.9;${NOW - 1};${mac}`,
    'short signature': `203.0.113.9;${ts};${mac.slice(0, 32)}`,
    'not hex': `203.0.113.9;${ts};${'z'.repeat(64)}`,
    'two parts': `203.0.113.9;${ts}`,
    'four parts': `${good};x`,
    'not an address': header('not-an-address'),
    'too long': header('1'.repeat(60)),
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.equal(verifyClientAddress(value, SECRET, NOW), null, name);
  }
});

test('no secret configured (or a short one): every header is ignored', () => {
  assert.equal(verifyClientAddress(header('203.0.113.9'), undefined, NOW), null);
  assert.equal(verifyClientAddress(header('203.0.113.9'), '', NOW), null);
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
  assert.equal(verifyClientAddress(header('203.0.113.9', NOW, short), short, NOW), null);
});

test('the signature is compared in constant time (source check: timingSafeEqual on bytes, no string comparison)', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'auth', 'client-address.ts'), 'utf8');
  assert.match(src, /timingSafeEqual\(given, expected\)/);
  assert.doesNotMatch(src, /mac\s*===|===\s*mac|expected\.toString\(|given\.toString\(/);
});

test('several values for the header (a repeated header) are ignored', () => {
  assert.equal(verifyClientAddress([header('203.0.113.9'), header('203.0.113.9')], SECRET, NOW), null);
});
