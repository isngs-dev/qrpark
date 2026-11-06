import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { isValidPaystackSignature } from './paystack.signature';

const SECRET = 'sk_test_abc123';
const BODY = Buffer.from(
  JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } }),
);
const sign = (body: Buffer, secret: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

test('accepts a correctly signed body', () => {
  assert.equal(isValidPaystackSignature(BODY, sign(BODY, SECRET), SECRET), true);
});

test('rejects a body altered after signing', () => {
  const signature = sign(BODY, SECRET);
  const tampered = Buffer.from(
    JSON.stringify({ event: 'charge.success', data: { reference: 'ref_2' } }),
  );
  assert.equal(isValidPaystackSignature(tampered, signature, SECRET), false);
});

test('rejects a signature made with a different secret', () => {
  assert.equal(
    isValidPaystackSignature(BODY, sign(BODY, 'sk_test_wrong'), SECRET),
    false,
  );
});

test('rejects a missing signature header', () => {
  assert.equal(isValidPaystackSignature(BODY, undefined, SECRET), false);
});

test('rejects a signature of the wrong length without throwing', () => {
  assert.equal(isValidPaystackSignature(BODY, 'deadbeef', SECRET), false);
});

test('rejects when the secret key is not configured', () => {
  assert.equal(isValidPaystackSignature(BODY, sign(BODY, SECRET), undefined), false);
});

test('rejects an empty body', () => {
  assert.equal(isValidPaystackSignature(undefined, sign(BODY, SECRET), SECRET), false);
});
