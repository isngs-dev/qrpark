import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bootTestApp, call, type TestApp } from '../test-support/app';

/**
 * User accounts over HTTP, as ADMIN: usernames, passwords, gate assignment,
 * the lockout rules and the audit trail. See docs/api.md, "Admin: users".
 */

let t: TestApp;
let admin: string;
before(async () => {
  t = await bootTestApp();
  admin = await t.accessToken(t.users.admin.id);
});
after(() => t?.close());

const post = (path: string, body: unknown) => call(t, 'POST', path, { token: admin, body });
const patch = (path: string, body: unknown) => call(t, 'PATCH', path, { token: admin, body });
const password = () => randomBytes(12).toString('base64url'); // 16 characters

async function lastAudit(targetId: string) {
  return t.prisma.auditLog.findFirst({ where: { siteId: t.siteId, targetId }, orderBy: { occurredAt: 'desc' } });
}

test('create an operator: username normalised, gate assigned, nothing secret returned or audited', async () => {
  const pw = password();
  const res = await post('/admin/users', {
    username: '  Entry.Two ',
    name: 'Entry two',
    role: 'ENTRY_OPERATOR',
    gateId: t.entryGateId,
    password: pw,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.username, 'entry.two');
  assert.equal(res.body.gate.code, 'ENTRY_1');
  assert.equal('passwordHash' in res.body, false);

  const audit = await lastAudit(res.body.id);
  assert.equal(audit?.action, 'USER_CREATED');
  assert.deepEqual(audit?.detail, { username: 'entry.two', role: 'ENTRY_OPERATOR', gateCode: 'ENTRY_1' });
  const auditText = JSON.stringify(audit);
  assert.ok(!auditText.includes(pw) && !auditText.includes('argon2'), 'the audit row holds a secret');

  const list = await call(t, 'GET', '/admin/users', { token: admin });
  assert.ok(!JSON.stringify(list.body).includes('argon2'), 'the list returns a hash');

  const signIn = await call(t, 'POST', '/auth/login', { body: { username: 'entry.two', password: pw } });
  assert.equal(signIn.status, 200);
});

test('password: fewer than 12 characters is refused, on create and on reset', async () => {
  const short = await post('/admin/users', {
    username: 'short.pw', name: 'Short', role: 'ADMIN', password: 'elevenchars',
  });
  assert.equal(short.status, 400);
  assert.equal(await t.prisma.appUser.findFirst({ where: { siteId: t.siteId, username: 'short.pw' } }), null);

  const reset = await post(`/admin/users/${t.users.entry.id}/password`, { password: 'elevenchars' });
  assert.equal(reset.status, 400);

  const twelve = await post('/admin/users', {
    username: 'twelve.pw', name: 'Twelve', role: 'ADMIN', password: 'twelve-chars',
  });
  assert.equal(twelve.status, 201);
});

test('username: bad format is 400, a duplicate is 409', async () => {
  for (const username of ['ab', 'has space', 'mail@site', 'x'.repeat(33)]) {
    const res = await post('/admin/users', { username, name: 'X', role: 'ADMIN', password: password() });
    assert.equal(res.status, 400, `"${username}" answered ${res.status}`);
  }
  const dup = await post('/admin/users', { username: 'ADMIN', name: 'Dup', role: 'ADMIN', password: password() });
  assert.equal(dup.status, 409);
});

test('gate rules: operators need an in-service gate facing their way; admins have none', async () => {
  const base = { name: 'G', password: password() };
  const cases: Array<[string, Record<string, unknown>]> = [
    ['entry operator without gate', { username: 'g1', role: 'ENTRY_OPERATOR' }],
    ['entry operator at an exit gate', { username: 'g2', role: 'ENTRY_OPERATOR', gateId: t.exitGateId }],
    ['exit operator at an entry gate', { username: 'g3', role: 'EXIT_OPERATOR', gateId: t.entryGateId }],
    ['admin with a gate', { username: 'g4', role: 'ADMIN', gateId: t.entryGateId }],
  ];
  for (const [label, body] of cases) {
    const res = await post('/admin/users', { ...base, ...body });
    assert.equal(res.status, 400, `${label} answered ${res.status}`);
  }

  const closed = await t.prisma.gate.create({
    data: { siteId: t.siteId, code: 'EXIT_CLOSED', name: 'Closed', direction: 'EXIT', isActive: false },
  });
  const res = await post('/admin/users', { ...base, username: 'g5', role: 'EXIT_OPERATOR', gateId: closed.id });
  assert.equal(res.status, 400, 'assigned to a gate out of service');
});

test('a role or gate change is audited and ends the user\'s sessions; a rename does not', async () => {
  const pw = password();
  const created = await post('/admin/users', {
    username: 'mover', name: 'Mover', role: 'ENTRY_OPERATOR', gateId: t.entryGateId, password: pw,
  });
  const signIn = await call(t, 'POST', '/auth/login', { body: { username: 'mover', password: pw } });
  const token = signIn.body.accessToken;

  const rename = await patch(`/admin/users/${created.body.id}`, { name: 'Mover Renamed' });
  assert.equal(rename.status, 200);
  assert.equal((await call(t, 'POST', '/auth/logout', { token })).status !== 401, true, 'a rename ended the session');

  const fresh = (await call(t, 'POST', '/auth/login', { body: { username: 'mover', password: pw } })).body.accessToken;
  const move = await patch(`/admin/users/${created.body.id}`, { role: 'EXIT_OPERATOR', gateId: t.exitGateId });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.equal((await call(t, 'POST', '/auth/logout', { token: fresh })).status, 401, 'the old session survived');

  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'USER_UPDATED');
  assert.deepEqual(audit?.detail, {
    username: 'mover',
    role: { from: 'ENTRY_OPERATOR', to: 'EXIT_OPERATOR' },
    gateCode: { from: 'ENTRY_1', to: 'EXIT_1' },
  });
});

test('a role change that leaves the gate facing the wrong way is refused', async () => {
  const res = await patch(`/admin/users/${t.users.entry.id}`, { role: 'EXIT_OPERATOR' });
  assert.equal(res.status, 400);
});

test('password reset: audited without the password, and ends the user\'s sessions', async () => {
  const before = await call(t, 'POST', '/auth/login', {
    body: { username: t.users.exit.username, password: t.users.exit.password },
  });
  const pw = password();
  const res = await post(`/admin/users/${t.users.exit.id}/password`, { password: pw });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: t.users.exit.id, passwordSet: true });

  assert.equal((await call(t, 'POST', '/auth/logout', { token: before.body.accessToken })).status, 401);
  const audit = await lastAudit(t.users.exit.id);
  assert.equal(audit?.action, 'USER_PASSWORD_RESET');
  assert.deepEqual(audit?.detail, { username: t.users.exit.username });
  assert.ok(!JSON.stringify(audit).includes(pw));

  const signIn = await call(t, 'POST', '/auth/login', { body: { username: t.users.exit.username, password: pw } });
  assert.equal(signIn.status, 200);
  t.users.exit.password = pw;
});

test('lockout: an admin cannot deactivate or demote themselves', async () => {
  const self = t.users.admin.id;
  assert.equal((await patch(`/admin/users/${self}`, { isActive: false })).status, 400);
  assert.equal((await patch(`/admin/users/${self}`, { role: 'ENTRY_OPERATOR', gateId: t.entryGateId })).status, 400);
});

test('lockout race: two admins deactivating each other at the same moment leave one admin, never none (30 rounds)', async () => {
  // Every other admin is retired, so each round has exactly two.
  await t.prisma.appUser.updateMany({
    where: { siteId: t.siteId, role: 'ADMIN', id: { not: t.users.admin.id } },
    data: { isActive: false },
  });
  const other = await post('/admin/users', { username: 'race.admin', name: 'Race', role: 'ADMIN', password: password() });
  assert.equal(other.status, 201);
  const pair = [t.users.admin.id, other.body.id as string];

  for (let round = 1; round <= 30; round++) {
    await t.prisma.appUser.updateMany({ where: { id: { in: pair } }, data: { isActive: true } });
    const [tokenA, tokenB] = [await t.accessToken(pair[0]), await t.accessToken(pair[1])];

    const [a, b] = await Promise.all([
      call(t, 'PATCH', `/admin/users/${pair[1]}`, { token: tokenA, body: { isActive: false } }),
      call(t, 'PATCH', `/admin/users/${pair[0]}`, { token: tokenB, body: { isActive: false } }),
    ]);

    const active = await t.prisma.appUser.count({ where: { siteId: t.siteId, role: 'ADMIN', isActive: true } });
    assert.equal(active, 1, `round ${round}: ${active} active admins left (statuses ${a.status}, ${b.status})`);
    // One wins. The loser is refused as the last admin (400), or, if the
    // winner deactivated it first, its own session has ended (401).
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200, `round ${round}: statuses ${statuses}`);
    assert.ok(statuses[1] === 400 || statuses[1] === 401, `round ${round}: statuses ${statuses}`);
  }

  // Restore the fixture admin for any later test.
  await t.prisma.appUser.update({ where: { id: t.users.admin.id }, data: { isActive: true } });
  admin = await t.accessToken(t.users.admin.id);
});
