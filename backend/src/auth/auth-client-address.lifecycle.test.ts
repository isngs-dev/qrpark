import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { LIMITS } from './login-throttle';

/**
 * T13: through the real sign-in route, with the shared secret configured.
 * The portal's server is the caller (one address, R); the signed header says
 * which browser typed the password. Only a valid header moves the counts to
 * the browser's address; anything else counts under R, as before.
 */

const SECRET = randomBytes(32).toString('hex');
let t: TestApp;
before(async () => {
  process.env.QRPARK_CLIENT_ADDRESS_SECRET = SECRET;
  t = await bootTestApp({ captureLogs: true });
});
after(() => t?.close());

const now = () => Math.floor(Date.now() / 1000);
const mac = (secret: string, address: string, ts: number) => createHmac('sha256', secret).update(`qrpark-login|${address}|${ts}`).digest('hex');
const signed = (address: string, ts = now(), secret = SECRET) => `${address};${ts};${mac(secret, address, ts)}`;
const tag = () => randomBytes(3).toString('hex');

/** A sign-in as the portal would send it: from the portal's own address R, with an optional header. */
async function login(username: string, password: string, portalAddress: string, clientHeader?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': portalAddress };
  if (clientHeader !== undefined) headers['x-qrpark-client-address'] = clientHeader;
  const res = await fetch(`${t.url}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password }) });
  return res.status;
}

async function operator() {
  const username = `t13.${tag()}`;
  const password = `pw-${randomBytes(9).toString('hex')}`;
  const res = await call(t, 'POST', '/admin/users', {
    token: await t.accessToken(t.users.admin.id),
    body: { username, name: username, role: 'ENTRY_OPERATOR', gateId: t.entryGateId, password },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id as string, username, password };
}

test('5 wrong portal sign-ins from one browser do not block the same account from another browser', async () => {
  const u = await operator();
  const portal = '10.20.0.1';
  for (let i = 0; i < LIMITS.pair; i++) assert.equal(await login(u.username, 'wrong-password-x', portal, signed('203.0.113.50')), 401);
  assert.equal(await login(u.username, 'wrong-password-x', portal, signed('203.0.113.50')), 429, 'that browser is blocked');
  assert.equal(await login(u.username, u.password, portal, signed('198.51.100.60')), 200, 'another browser, through the same portal, signs in');
});

test('a valid header moves the counts to the browser: 30 failures from one browser block that browser only', async () => {
  const portal = '10.20.0.2';
  for (let i = 0; i < LIMITS.ip; i++) assert.equal(await login(`spray.${tag()}`, 'wrong-password-x', portal, signed('203.0.113.70')), 401);
  const u = await operator();
  assert.equal(await login(u.username, u.password, portal, signed('203.0.113.70')), 429);
  assert.equal(await login(u.username, u.password, portal, signed('203.0.113.71')), 200, 'the portal itself is not blocked');
});

const ignoredCases: Record<string, (address: string) => string | undefined> = {
  missing: () => undefined,
  forged: (a) => `${a};${now()};${'0'.repeat(64)}`,
  expired: (a) => signed(a, now() - 120),
  'wrong secret': (a) => signed(a, now(), randomBytes(32).toString('hex')),
  tampered: (a) => {
    const [, ts, m] = signed('203.0.113.1').split(';');
    return `${a};${ts};${m}`;
  },
};

for (const [name, make] of Object.entries(ignoredCases)) {
  test(`a ${name} header is ignored: the backend counts under its own view of the caller`, async () => {
    const u = await operator();
    const portal = `10.30.${Object.keys(ignoredCases).indexOf(name)}.1`;
    // Each attempt claims a different browser; if the header were believed, nothing would block.
    for (let i = 0; i < LIMITS.pair; i++) assert.equal(await login(u.username, 'wrong-password-x', portal, make(`192.0.2.${10 + i}`)), 401);
    assert.equal(await login(u.username, u.password, portal, make('192.0.2.99')), 429, 'all counted under the portal address');
  });
}

test('the header is read only by the sign-in route (source check)', () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && /CLIENT_ADDRESS_HEADER|x-qrpark-client-address|clientAddressOf/.test(readFileSync(p, 'utf8'))) hits.push(p.replace(/\\/g, '/').replace(/^.*\/src\//, ''));
    }
  };
  walk(join(__dirname, '..', '..', 'src'));
  assert.deepEqual(hits.sort(), ['auth/auth.controller.ts', 'auth/client-address.ts']);
  const controller = readFileSync(join(__dirname, '..', '..', 'src', 'auth', 'auth.controller.ts'), 'utf8');
  const uses = controller.split('\n').filter((l) => /clientAddressOf\(/.test(l));
  assert.equal(uses.length, 1, 'used once');
  const loginStart = controller.indexOf("@Post('login')");
  const refreshStart = controller.indexOf("@Post('refresh')");
  const at = controller.indexOf('clientAddressOf(');
  assert.ok(at > loginStart && at < refreshStart, 'inside the login handler only');
});

test('no audit row and no log line holds the browser address or the header', async () => {
  const u = await operator();
  const browser = '203.0.113.188';
  const header = signed(browser);
  for (let i = 0; i < LIMITS.pair + 1; i++) await login(u.username, 'wrong-password-x', '10.40.0.1', header);
  const rows = await t.prisma.auditLog.findMany({ where: { siteId: t.siteId, action: 'LOGIN_THROTTLED' as never, targetId: u.id } });
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(browser));
  assert.ok(!t.logs.some((l) => l.includes(browser) || l.includes(header.split(';')[2])), 'no log line');
});
