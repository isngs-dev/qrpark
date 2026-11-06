import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_REFERENCE_PATTERN,
  TICKET_NUMBER_ALPHABET,
  TICKET_NUMBER_PATTERN,
  TOKEN_PATTERN,
  newPaymentReference,
  newTicketNumber,
  newToken,
  normaliseTicketNumber,
} from './ticket-codes';

/**
 * The QR token, the ticket number and the payment reference. The patterns
 * here are the same as the database CHECKs (ticket_token_check,
 * ticket_ticket_number_check), so a generated value is always storable.
 */

test('token: 43 base64url characters (256 random bits), and never repeats', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const token = newToken();
    assert.match(token, TOKEN_PATTERN);
    assert.equal(token.length, 43);
    seen.add(token);
  }
  assert.equal(seen.size, 500);
  assert.equal(TOKEN_PATTERN.source, '^[A-Za-z0-9_-]{43}$', 'must match ticket_token_check');
});

test('token: not derived from anything (no ids, no time): two in a row share no prefix', () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a.slice(0, 8), b.slice(0, 8));
});

test('ticket number: XXXX-XXXX from the alphabet without look-alikes', () => {
  assert.equal(TICKET_NUMBER_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  for (const c of '0O1IL') assert.ok(!TICKET_NUMBER_ALPHABET.includes(c));
  for (let i = 0; i < 300; i++) assert.match(newTicketNumber(), TICKET_NUMBER_PATTERN);
  assert.equal(TICKET_NUMBER_PATTERN.source, '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$', 'must match ticket_ticket_number_check');
});

test('ticket number: built from the picker it is given (a cryptographic one by default)', () => {
  let i = 0;
  const picks = [0, 1, 2, 3, 30, 29, 28, 27];
  assert.equal(newTicketNumber(() => picks[i++]), 'ABCD-9876');
});

test('ticket number input: trimmed, upper-cased, hyphen optional; anything else is null', () => {
  assert.equal(normaliseTicketNumber(' abcd-efgh '), 'ABCD-EFGH');
  assert.equal(normaliseTicketNumber('ABCDEFGH'), 'ABCD-EFGH');
  for (const bad of ['ABCD-EFG0', 'ABCD-EFGI', 'ABC-DEFGH', '', 'ABCD EFGH', 'ABCD-EFGHJ']) {
    assert.equal(normaliseTicketNumber(bad), null, `accepted "${bad}"`);
  }
  assert.equal(normaliseTicketNumber(undefined as unknown as string), null);
});

test('payment reference: QRP_ and 24 random hex characters; no site, amount or sequence in it', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const ref = newPaymentReference();
    assert.match(ref, PAYMENT_REFERENCE_PATTERN);
    seen.add(ref);
  }
  assert.equal(seen.size, 200);
});
