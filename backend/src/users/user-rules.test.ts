import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  assertGateForRole,
  assertNotLastAdmin,
  assertNotSelfLockout,
  assertPassword,
  endsSessions,
  normaliseUsername,
  planUserUpdate,
} from './user-rules';

/** Pure user-account rules; adapted from eparking backend/src/staff/staff-rules.test.ts. */

test('username: trimmed and lower-cased; 3-32 of a-z 0-9 . _ -', () => {
  assert.equal(normaliseUsername('  Entry.One '), 'entry.one');
  assert.equal(normaliseUsername('exit_op-2'), 'exit_op-2');
  for (const bad of ['ab', 'x'.repeat(33), 'has space', 'mail@site', '', 'naïve']) {
    assert.throws(() => normaliseUsername(bad), BadRequestException, `accepted "${bad}"`);
  }
});

test('password: at least 12 characters', () => {
  assert.doesNotThrow(() => assertPassword('twelve-chars'));
  assert.throws(() => assertPassword('elevenchars'), BadRequestException);
  assert.throws(() => assertPassword(undefined as unknown as string), BadRequestException);
});

test('gate for role: admin none; operator an in-service gate facing its way', () => {
  const entry = { direction: 'ENTRY' as const, isActive: true, code: 'ENTRY_1' };
  const exit = { direction: 'EXIT' as const, isActive: true, code: 'EXIT_1' };
  assert.doesNotThrow(() => assertGateForRole('ADMIN', null));
  assert.doesNotThrow(() => assertGateForRole('ENTRY_OPERATOR', entry));
  assert.doesNotThrow(() => assertGateForRole('EXIT_OPERATOR', exit));
  assert.throws(() => assertGateForRole('ADMIN', entry), BadRequestException);
  assert.throws(() => assertGateForRole('ENTRY_OPERATOR', null), BadRequestException);
  assert.throws(() => assertGateForRole('ENTRY_OPERATOR', exit), BadRequestException);
  assert.throws(() => assertGateForRole('EXIT_OPERATOR', entry), BadRequestException);
  assert.throws(() => assertGateForRole('EXIT_OPERATOR', { ...exit, isActive: false }), BadRequestException);
});

test('self-lockout: an admin cannot deactivate or demote themselves; may rename', () => {
  const me = { id: 'a', role: 'ADMIN' as const };
  assert.throws(() => assertNotSelfLockout('a', me, { isActive: false }), BadRequestException);
  assert.throws(() => assertNotSelfLockout('a', me, { role: 'ENTRY_OPERATOR' }), BadRequestException);
  assert.doesNotThrow(() => assertNotSelfLockout('a', me, {}));
  assert.doesNotThrow(() => assertNotSelfLockout('b', me, { isActive: false }));
});

test('last admin: cannot be deactivated or demoted when no other active admin exists', () => {
  const lastAdmin = { role: 'ADMIN' as const, isActive: true };
  assert.throws(() => assertNotLastAdmin(lastAdmin, { isActive: false }, 0), BadRequestException);
  assert.throws(() => assertNotLastAdmin(lastAdmin, { role: 'EXIT_OPERATOR' }, 0), BadRequestException);
  assert.doesNotThrow(() => assertNotLastAdmin(lastAdmin, { isActive: false }, 1));
  assert.doesNotThrow(() => assertNotLastAdmin({ role: 'ENTRY_OPERATOR', isActive: true }, { isActive: false }, 0));
});

test('update plan: only what changed; nothing is an error; which changes end sessions', () => {
  const current = { name: 'A', role: 'ENTRY_OPERATOR' as const, gateId: 'g1', isActive: true };
  assert.deepEqual(planUserUpdate(current, { name: ' B ', role: 'ENTRY_OPERATOR' }), { name: 'B' });
  assert.throws(() => planUserUpdate(current, { name: 'A' }), BadRequestException);
  assert.throws(() => planUserUpdate(current, { name: '  ' }), BadRequestException);
  assert.equal(endsSessions({ name: 'B' }), false);
  assert.equal(endsSessions({ role: 'EXIT_OPERATOR' }), true);
  assert.equal(endsSessions({ gateId: 'g2' }), true);
  assert.equal(endsSessions({ isActive: false }), true);
  assert.equal(endsSessions({ isActive: true }), false);
});

test('gate for role: a payment operator needs an in-service BOOTH, and only a booth', () => {
  const booth = { direction: 'BOOTH' as const, isActive: true, code: 'BOOTH_1' };
  assert.doesNotThrow(() => assertGateForRole('PAYMENT_OPERATOR', booth));
  assert.throws(() => assertGateForRole('PAYMENT_OPERATOR', null), BadRequestException);
  assert.throws(() => assertGateForRole('PAYMENT_OPERATOR', { ...booth, isActive: false }), BadRequestException);
  for (const direction of ['ENTRY', 'EXIT'] as const) {
    assert.throws(() => assertGateForRole('PAYMENT_OPERATOR', { ...booth, direction }), BadRequestException);
  }
  for (const role of ['ENTRY_OPERATOR', 'EXIT_OPERATOR'] as const) {
    assert.throws(() => assertGateForRole(role, booth), BadRequestException, `${role} accepted a booth`);
  }
});
