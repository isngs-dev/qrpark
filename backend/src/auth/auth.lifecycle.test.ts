import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp } from '../test-support/app';

/**
 * Sign-in, refresh, logout and what the guard refuses, over HTTP against a
 * real database. See docs/api.md, "Auth".
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp();
});
after(() => t?.close());

async function login(username: string, password: string) {
  return call(t, 'POST', '/auth/login', { body: { username, password } });
}

test('/health stays public: no token, 200', async () => {
  const res = await call(t, 'GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('login: returns tokens, the user, the gate and the site display name; never a hash', async () => {
  const { entry } = t.users;
  const res = await login(entry.username, entry.password);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.accessToken, 'string');
  assert.equal(typeof res.body.refreshToken, 'string');
  assert.deepEqual(res.body.user, { id: entry.id, username: entry.username, name: entry.username, role: 'ENTRY_OPERATOR' });
  assert.deepEqual(res.body.gate, { id: t.entryGateId, code: 'ENTRY_1', name: 'Entry 1', direction: 'ENTRY' });
  assert.deepEqual(res.body.site, { code: t.siteCode, displayName: 'Test Market' });
  assert.ok(!JSON.stringify(res.body).includes('argon2'), 'response contains a password hash');
});

test('login: an admin has no gate', async () => {
  const res = await login(t.users.admin.username, t.users.admin.password);
  assert.equal(res.status, 200);
  assert.equal(res.body.gate, null);
});

test('login: the username is matched case-insensitively (stored lower-case)', async () => {
  const res = await login(t.users.exit.username.toUpperCase(), t.users.exit.password);
  assert.equal(res.status, 200);
});

test('login: wrong password and unknown username get the same 401', async () => {
  const wrong = await login(t.users.entry.username, 'not-the-password-at-all');
  const unknown = await login('nobody.here', 'not-the-password-at-all');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('the guard: a refresh token cannot call the API', async () => {
  const { body } = await login(t.users.admin.username, t.users.admin.password);
  const res = await call(t, 'GET', '/admin/settings', { token: body.refreshToken });
  assert.equal(res.status, 401);
});

test('refresh: an access token cannot be used to refresh', async () => {
  const { body } = await login(t.users.admin.username, t.users.admin.password);
  const res = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: body.accessToken } });
  assert.equal(res.status, 401);
});

test('refresh: a refresh token gives a working access token', async () => {
  const { body } = await login(t.users.admin.username, t.users.admin.password);
  const refreshed = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: body.refreshToken } });
  assert.equal(refreshed.status, 200);
  const res = await call(t, 'GET', '/admin/settings', { token: refreshed.body.accessToken });
  assert.equal(res.status, 200);
});

test('the guard: an expired, a forged and a garbage token are 401', async () => {
  const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { id: t.users.admin.id } });
  const claims = { sub: admin.id, siteId: admin.siteId, role: 'ADMIN', typ: 'access', ver: admin.tokenVersion };

  const expired = t.sign(claims, -10);
  assert.equal((await call(t, 'GET', '/admin/settings', { token: expired })).status, 401);

  const [h, p] = t.sign(claims).split('.');
  const forged = `${h}.${p}.${'A'.repeat(43)}`;
  assert.equal((await call(t, 'GET', '/admin/settings', { token: forged })).status, 401);

  assert.equal((await call(t, 'GET', '/admin/settings', { token: 'garbage' })).status, 401);
});

test('the guard: a role claimed in the token is not trusted; the database role is', async () => {
  const exit = await t.prisma.appUser.findUniqueOrThrow({ where: { id: t.users.exit.id } });
  const lying = t.sign({ sub: exit.id, siteId: exit.siteId, role: 'ADMIN', typ: 'access', ver: exit.tokenVersion });
  const res = await call(t, 'GET', '/admin/settings', { token: lying });
  assert.equal(res.status, 403);
});

test('logout: ends the session at once, for the access and the refresh token', async () => {
  const { entry } = t.users;
  const { body } = await login(entry.username, entry.password);

  const out = await call(t, 'POST', '/auth/logout', { token: body.accessToken });
  assert.equal(out.status, 204);

  const again = await call(t, 'POST', '/auth/logout', { token: body.accessToken });
  assert.equal(again.status, 401, 'the access token still worked after logout');

  const refresh = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: body.refreshToken } });
  assert.equal(refresh.status, 401, 'the refresh token still worked after logout');

  const fresh = await login(entry.username, entry.password);
  assert.equal(fresh.status, 200, 'cannot sign in again after logout');
});

test('a deactivated account: refused at once, by the guard, refresh and login', async () => {
  const { exit } = t.users;
  const { body } = await login(exit.username, exit.password);

  await t.prisma.appUser.update({ where: { id: exit.id }, data: { isActive: false } });
  try {
    const api = await call(t, 'POST', '/auth/logout', { token: body.accessToken });
    assert.equal(api.status, 401);
    const refresh = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: body.refreshToken } });
    assert.equal(refresh.status, 401);
    const again = await login(exit.username, exit.password);
    assert.equal(again.status, 401);
  } finally {
    await t.prisma.appUser.update({ where: { id: exit.id }, data: { isActive: true } });
  }
});

test('a token from an older token_version is refused', async () => {
  const { body } = await login(t.users.admin.username, t.users.admin.password);
  await t.prisma.appUser.update({ where: { id: t.users.admin.id }, data: { tokenVersion: { increment: 1 } } });
  const res = await call(t, 'GET', '/admin/settings', { token: body.accessToken });
  assert.equal(res.status, 401);
});
