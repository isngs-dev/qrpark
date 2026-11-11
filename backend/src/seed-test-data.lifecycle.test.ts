import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { requireDatabase, uniqueCode } from './test-support/db';
import { seedSite } from './seed-site';
import { seedTestData } from './seed-test-data';

/**
 * Both seeds against a real database, on a fresh "-test" site each time
 * (rows are committed; `migrate reset` on the test database clears them).
 * Adapted from eparking backend/src/seed-test-data.lifecycle.test.ts.
 */

requireDatabase();
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

/** A strong random password for one test (never printed). */
const strong = () => `Seed-${randomBytes(12).toString('base64url')}`;

/** The three operators' passwords, as the server's .env would hold them. */
function operatorEnv() {
  return { SEED_ENTRY_PASSWORD: strong(), SEED_BOOTH_PASSWORD: strong(), SEED_EXIT_PASSWORD: strong() };
}

function capture() {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

async function seededSite() {
  const code = uniqueCode('seed');
  const adminPassword = strong();
  const out = capture();
  await seedSite({
    prisma,
    env: { SITE_CODE: code, SITE_NAME: 'Seed Test', SEED_ADMIN_USERNAME: 'Admin', SEED_ADMIN_PASSWORD: adminPassword },
    print: out.print,
  });
  return { code, adminPassword, lines: out.lines };
}

test('seed-site: site, settings and admin; a second run changes nothing', async () => {
  const { code, adminPassword, lines } = await seededSite();
  assert.ok(!lines.join('\n').includes(adminPassword), 'seed-site printed the admin password');

  const site = await prisma.site.findUniqueOrThrow({ where: { code }, include: { setting: true, users: true } });
  assert.equal(site.setting?.displayName, 'Seed Test');
  assert.deepEqual(site.users.map((u) => `${u.username}:${u.role}:${u.gateId}`), ['admin:ADMIN:null']);

  const again = capture();
  await seedSite({
    prisma,
    env: { SITE_CODE: code, SITE_NAME: 'Renamed', SEED_ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: strong() },
    print: again.print,
  });
  assert.ok(again.lines.every((l) => !l.includes('created')), again.lines.join('\n'));
  const after = await prisma.site.findUniqueOrThrow({ where: { code }, include: { setting: true, users: true } });
  assert.equal(after.setting?.displayName, 'Seed Test');
  assert.equal(after.users[0].passwordHash, site.users[0].passwordHash);
});

test('seed-site: a short admin password is refused before anything is written', async () => {
  const code = uniqueCode('short');
  await assert.rejects(
    seedSite({ prisma, env: { SITE_CODE: code, SEED_ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: 'elevenchars' }, print: () => {} }),
    /at least 12 characters/,
  );
  assert.equal(await prisma.site.findUnique({ where: { code } }), null);
});

test('seed-site: a weak or missing admin password is refused before anything is written (6a)', async () => {
  const code = uniqueCode('weak');
  for (const env of [
    { SITE_CODE: code, SEED_ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: 'password1234' },
    { SITE_CODE: code, SEED_ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: 'admin-admin-admin' },
    { SITE_CODE: code, SEED_ADMIN_USERNAME: 'admin' },
    { SITE_CODE: code, SEED_ADMIN_PASSWORD: strong() },
  ]) {
    const out = capture();
    await assert.rejects(seedSite({ prisma, env, print: out.print }), /SEED_ADMIN/);
    assert.deepEqual(out.lines, [], 'printed before refusing');
  }
  assert.equal(await prisma.site.findUnique({ where: { code } }), null);
});

test('seed-test-data: refuses a site not ending in -test before touching the database', async () => {
  const before = await prisma.site.count();
  for (const siteCode of ['garki', undefined, 'garki-TEST']) {
    await assert.rejects(seedTestData({ prisma, siteCode, env: operatorEnv(), print: () => {} }), /^Error: Refused/);
  }
  assert.equal(await prisma.site.count(), before);
});

test('seed-test-data: first run creates everything, audited; second run keeps everything', async () => {
  const { code } = await seededSite();
  const first = capture();
  const env = operatorEnv();
  const outcome = await seedTestData({ prisma, siteCode: code, env, print: first.print });

  assert.equal(outcome.created.length, 13, first.lines.join('\n')); // 4 locations + 6 categories + 3 accounts
  assert.equal(outcome.kept.length, 0);

  const site = await prisma.site.findUniqueOrThrow({ where: { code } });
  const categories = await prisma.vehicleCategory.findMany({ where: { siteId: site.id }, orderBy: { code: 'asc' } });
  assert.deepEqual(
    categories.map((c) => `${c.code}:${c.priceKobo}`),
    ['BIKE:20000', 'CAR:50000', 'LORRY:120000', 'SUV:50000', 'TRUCK:100000', 'VAN:70000'],
  );
  const operators = await prisma.appUser.findMany({
    where: { siteId: site.id, role: { not: 'ADMIN' } },
    include: { gate: true },
    orderBy: { username: 'asc' },
  });
  assert.deepEqual(operators.map((u) => `${u.username}:${u.role}:${u.gate?.code}`), [
    'booth-1:PAYMENT_OPERATOR:BOOTH_1',
    'entry-1:ENTRY_OPERATOR:ENTRY_1',
    'exit-1:EXIT_OPERATOR:EXIT_1',
  ]);

  // 6a: each password comes from its SEED_* variable, is stored only as its hash,
  // and is printed nowhere and audited nowhere.
  const byName = new Map(operators.map((u) => [u.username, u.passwordHash]));
  assert.ok(await argon2.verify(byName.get('entry-1')!, env.SEED_ENTRY_PASSWORD), 'entry-1 signs in with SEED_ENTRY_PASSWORD');
  assert.ok(await argon2.verify(byName.get('booth-1')!, env.SEED_BOOTH_PASSWORD), 'booth-1 signs in with SEED_BOOTH_PASSWORD');
  assert.ok(await argon2.verify(byName.get('exit-1')!, env.SEED_EXIT_PASSWORD), 'exit-1 signs in with SEED_EXIT_PASSWORD');
  const audit = await prisma.auditLog.findMany({ where: { siteId: site.id } });
  assert.equal(audit.length, 13);
  for (const pw of Object.values(env)) {
    assert.ok(!first.lines.join('\n').includes(pw), 'a password was printed');
    assert.ok(!JSON.stringify(audit).includes(pw), 'a password reached the audit log');
  }
  assert.ok(!first.lines.some((l) => /password: /i.test(l)), 'a password line was printed');

  // A re-run with OTHER passwords in .env changes no account's password.
  const second = capture();
  const again = await seedTestData({ prisma, siteCode: code, env: operatorEnv(), print: second.print });
  assert.equal(again.created.length, 0, second.lines.join('\n'));
  assert.equal(again.kept.length, 13);
  const afterRerun = await prisma.appUser.findMany({ where: { siteId: site.id, role: { not: 'ADMIN' } }, orderBy: { username: 'asc' } });
  assert.deepEqual(afterRerun.map((u) => u.passwordHash), operators.map((u) => u.passwordHash), 'a re-run changed a password');
  assert.equal(await prisma.auditLog.count({ where: { siteId: site.id } }), 13, 're-run wrote audit rows');
});

test('seed-test-data: a missing or weak SEED_* password is refused before anything is read or written (6a)', async () => {
  const { code } = await seededSite();
  const site = await prisma.site.findUniqueOrThrow({ where: { code } });
  const withoutExit = operatorEnv() as Record<string, string>;
  delete withoutExit.SEED_EXIT_PASSWORD;
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ ...operatorEnv(), SEED_BOOTH_PASSWORD: '' }, /SEED_BOOTH_PASSWORD is not set/],
    [withoutExit, /SEED_EXIT_PASSWORD is not set/],
    [{ ...operatorEnv(), SEED_ENTRY_PASSWORD: 'short-pass1' }, /SEED_ENTRY_PASSWORD is too short/],
    [{ ...operatorEnv(), SEED_BOOTH_PASSWORD: 'qwertyuiop12' }, /SEED_BOOTH_PASSWORD is too weak/],
  ];
  for (const [env, why] of cases) {
    const out = capture();
    await assert.rejects(seedTestData({ prisma, siteCode: code, env, print: out.print }), why);
    assert.deepEqual(out.lines, [], 'printed before refusing');
  }
  assert.equal(await prisma.gate.count({ where: { siteId: site.id } }), 0, 'wrote a location before refusing');
  assert.equal(await prisma.appUser.count({ where: { siteId: site.id } }), 1, 'only the admin');
});

test('seed-test-data: a price changed in the portal is kept by a re-run', async () => {
  const { code } = await seededSite();
  await seedTestData({ prisma, siteCode: code, env: operatorEnv(), print: () => {} });
  const site = await prisma.site.findUniqueOrThrow({ where: { code } });
  await prisma.vehicleCategory.update({ where: { siteId_code: { siteId: site.id, code: 'CAR' } }, data: { priceKobo: 55_500 } });
  await seedTestData({ prisma, siteCode: code, env: operatorEnv(), print: () => {} });
  const car = await prisma.vehicleCategory.findUniqueOrThrow({ where: { siteId_code: { siteId: site.id, code: 'CAR' } } });
  assert.equal(car.priceKobo, 55_500);
});
