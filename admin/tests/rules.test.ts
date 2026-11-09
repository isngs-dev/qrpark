import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koboFromNaira, lagosTime, naira } from '../lib/config-types.ts';
import { cookieNames, cookieOptions, ACCESS_MAX_AGE_SECONDS, REFRESH_MAX_AGE_SECONDS } from '../lib/cookie-names.ts';
import {
  MIN_PASSWORD_LENGTH,
  lockoutWarning,
  mayUsePortal,
  operatorProblem,
  passwordProblem,
  type UserAccount,
} from '../lib/users-types.ts';

/** Sprint 5b: the portal's own rules. Every figure and every decision is the backend's; these only display and pre-check. */

// ---------------------------------------------------------------- money

test('naira from kobo is string work: ₦, thousands grouped, two decimals, never floating point', () => {
  assert.equal(naira(50_000), '₦500.00');
  assert.equal(naira(5), '₦0.05');
  assert.equal(naira(0), '₦0.00');
  assert.equal(naira(123_456_789), '₦1,234,567.89');
  assert.equal(naira(2_147_483_647), '₦21,474,836.47');
  assert.equal(naira(10), '₦0.10');
  assert.throws(() => naira(1.5));
  assert.throws(() => naira(-100));
  assert.throws(() => naira(Number.MAX_SAFE_INTEGER + 2));
});

test('a typed naira price becomes integer kobo by digits, never by floating point', () => {
  assert.equal(koboFromNaira('500'), 50_000);
  assert.equal(koboFromNaira('500.1'), 50_010);
  assert.equal(koboFromNaira('500.10'), 50_010);
  assert.equal(koboFromNaira('1,200.05'), 120_005);
  assert.equal(koboFromNaira('₦750'), 75_000);
  assert.equal(koboFromNaira(' 0.29 '), 29); // 0.29 * 100 is 28.999999999999996 in floating point
  assert.equal(koboFromNaira('21474836.47'), 2_147_483_647);
  for (const bad of ['', '  ', 'abc', '5.123', '-5', '1e3', '5.', '.5', '1.2.3', '21474836.48', '0', '0.00', '5 00']) {
    assert.equal(koboFromNaira(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------- time

test('times are shown in Africa/Lagos, whatever the reader\'s clock says', () => {
  assert.equal(lagosTime('2026-11-07T23:30:00.000Z'), '08 Nov 2026, 00:30');
  assert.equal(lagosTime('2026-11-07T13:05:59.000Z'), '07 Nov 2026, 14:05');
  assert.equal(lagosTime(null), '—');
});

// ---------------------------------------------------------------- session cookies

test('cookies: httpOnly, SameSite=Lax, path /, no Domain; Secure and __Host- in production only', () => {
  const prod = cookieOptions(true);
  assert.deepEqual(prod, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
  assert.ok(!('domain' in prod), 'never a Domain');
  const dev = cookieOptions(false);
  assert.deepEqual(dev, { httpOnly: true, sameSite: 'lax', secure: false, path: '/' });

  const p = cookieNames(true);
  for (const name of Object.values(p)) assert.ok(name.startsWith('__Host-'), name);
  const d = cookieNames(false);
  for (const name of Object.values(d)) assert.ok(!name.startsWith('__'), name);
  assert.equal(new Set(Object.values(p)).size, 3);
});

test('the access cookie dies before the 15-minute access token, so the refresh runs first; the refresh cookie lasts its 7 days', () => {
  assert.ok(ACCESS_MAX_AGE_SECONDS < 15 * 60);
  assert.ok(ACCESS_MAX_AGE_SECONDS >= 10 * 60);
  assert.equal(REFRESH_MAX_AGE_SECONDS, 7 * 24 * 60 * 60);
});

// ---------------------------------------------------------------- access

test('only an ADMIN account may sign in to the portal', () => {
  assert.equal(mayUsePortal('ADMIN'), true);
  for (const role of ['ENTRY_OPERATOR', 'PAYMENT_OPERATOR', 'EXIT_OPERATOR', 'admin', '', undefined]) {
    assert.equal(mayUsePortal(role as string | undefined), false, String(role));
  }
});

// ---------------------------------------------------------------- operators

const gates = [
  { id: 'g-entry', code: 'ENTRY_1', name: 'Entry 1', direction: 'ENTRY' as const, isActive: true },
  { id: 'g-booth', code: 'BOOTH_1', name: 'Booth 1', direction: 'BOOTH' as const, isActive: true },
  { id: 'g-exit', code: 'EXIT_1', name: 'Exit 1', direction: 'EXIT' as const, isActive: true },
  { id: 'g-old', code: 'BOOTH_9', name: 'Old booth', direction: 'BOOTH' as const, isActive: false },
];

test('a password is at least 12 characters (as the backend enforces)', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(passwordProblem('x'.repeat(12)), null);
  assert.match(passwordProblem('x'.repeat(11)) ?? '', /12/);
  assert.match(passwordProblem('') ?? '', /12/);
});

test('one job, one in-service location of that job\'s kind; an admin has none', () => {
  assert.equal(operatorProblem({ role: 'ENTRY_OPERATOR', gateId: 'g-entry' }, gates), null);
  assert.equal(operatorProblem({ role: 'PAYMENT_OPERATOR', gateId: 'g-booth' }, gates), null);
  assert.equal(operatorProblem({ role: 'EXIT_OPERATOR', gateId: 'g-exit' }, gates), null);
  assert.equal(operatorProblem({ role: 'ADMIN', gateId: '' }, gates), null);
  assert.match(operatorProblem({ role: 'ENTRY_OPERATOR', gateId: '' }, gates) ?? '', /entry gate/i);
  assert.match(operatorProblem({ role: 'PAYMENT_OPERATOR', gateId: 'g-entry' }, gates) ?? '', /booth/i);
  assert.match(operatorProblem({ role: 'EXIT_OPERATOR', gateId: 'g-booth' }, gates) ?? '', /exit gate/i);
  assert.match(operatorProblem({ role: 'PAYMENT_OPERATOR', gateId: 'g-old' }, gates) ?? '', /in service/i);
  assert.match(operatorProblem({ role: 'ADMIN', gateId: 'g-entry' }, gates) ?? '', /admin/i);
  assert.match(operatorProblem({ role: 'SUPERVISOR', gateId: '' }, gates) ?? '', /job/i);
});

test('nobody deactivates or deletes themselves or the last active admin (shown; the backend refuses)', () => {
  const acc = (o: Partial<UserAccount>): UserAccount => ({
    id: 'u1', username: 'a', name: 'A', role: 'ADMIN', isActive: true, gate: null, createdAt: '', updatedAt: '', ...o,
  });
  assert.match(lockoutWarning(acc({}), 'u1', 3) ?? '', /yourself/i);
  assert.match(lockoutWarning(acc({ id: 'u2' }), 'u1', 1) ?? '', /last active admin/i);
  assert.equal(lockoutWarning(acc({ id: 'u2' }), 'u1', 2), null);
  assert.equal(lockoutWarning(acc({ id: 'u3', role: 'EXIT_OPERATOR' }), 'u1', 1), null);
  assert.equal(lockoutWarning(acc({ id: 'u2', isActive: false }), 'u1', 1), null);
});
