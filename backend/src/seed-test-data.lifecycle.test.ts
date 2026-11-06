import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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

function capture() {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

async function seededSite() {
  const code = uniqueCode('seed');
  const adminPassword = randomBytes(12).toString('base64url');
  const out = capture();
  await seedSite({
    prisma,
    env: { SITE_CODE: code, SITE_NAME: 'Seed Test', ADMIN_USERNAME: 'Admin', ADMIN_PASSWORD: adminPassword },
    print: out.print,
  });
  return { code, adminPassword, lines: out.lines };
}

test('seed-site: site, settings (validity 12) and admin; a second run changes nothing', async () => {
  const { code, adminPassword, lines } = await seededSite();
  assert.ok(!lines.join('\n').includes(adminPassword), 'seed-site printed the admin password');

  const site = await prisma.site.findUniqueOrThrow({ where: { code }, include: { setting: true, users: true } });
  assert.equal(site.setting?.validityHours, 12);
  assert.equal(site.setting?.displayName, 'Seed Test');
  assert.deepEqual(site.users.map((u) => `${u.username}:${u.role}:${u.gateId}`), ['admin:ADMIN:null']);

  const again = capture();
  await seedSite({
    prisma,
    env: { SITE_CODE: code, SITE_NAME: 'Renamed', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'a-different-password' },
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
    seedSite({ prisma, env: { SITE_CODE: code, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'elevenchars' }, print: () => {} }),
    /at least 12 characters/,
  );
  assert.equal(await prisma.site.findUnique({ where: { code } }), null);
});

test('seed-test-data: refuses a site not ending in -test before touching the database', async () => {
  const before = await prisma.site.count();
  for (const siteCode of ['garki', undefined, 'garki-TEST']) {
    await assert.rejects(seedTestData({ prisma, siteCode, print: () => {} }), /^Error: Refused/);
  }
  assert.equal(await prisma.site.count(), before);
});

test('seed-test-data: first run creates everything, audited; second run keeps everything', async () => {
  const { code } = await seededSite();
  const first = capture();
  const outcome = await seedTestData({ prisma, siteCode: code, print: first.print });

  assert.equal(outcome.created.length, 10, first.lines.join('\n')); // 2 gates + 6 categories + 2 accounts
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
    'entry-1:ENTRY_OPERATOR:ENTRY_1',
    'exit-1:EXIT_OPERATOR:EXIT_1',
  ]);

  // Passwords: printed once, each stored only as its hash, and none in the audit.
  const printed = first.lines.filter((l) => l.includes('password: '));
  assert.equal(printed.length, 2);
  const audit = await prisma.auditLog.findMany({ where: { siteId: site.id } });
  assert.equal(audit.length, 10);
  for (const line of printed) {
    const pw = line.split('password: ')[1];
    assert.ok(!JSON.stringify(audit).includes(pw), 'a password reached the audit log');
    assert.ok(!operators.some((u) => u.passwordHash.includes(pw)));
  }

  const second = capture();
  const again = await seedTestData({ prisma, siteCode: code, print: second.print });
  assert.equal(again.created.length, 0, second.lines.join('\n'));
  assert.equal(again.kept.length, 10);
  assert.ok(!second.lines.some((l) => l.includes('password: ')), 'a re-run printed a password');
  assert.equal(await prisma.auditLog.count({ where: { siteId: site.id } }), 10, 're-run wrote audit rows');
});

test('seed-test-data: a price changed in the portal is kept by a re-run', async () => {
  const { code } = await seededSite();
  await seedTestData({ prisma, siteCode: code, print: () => {} });
  const site = await prisma.site.findUniqueOrThrow({ where: { code } });
  await prisma.vehicleCategory.update({ where: { siteId_code: { siteId: site.id, code: 'CAR' } }, data: { priceKobo: 55_500 } });
  await seedTestData({ prisma, siteCode: code, print: () => {} });
  const car = await prisma.vehicleCategory.findUniqueOrThrow({ where: { siteId_code: { siteId: site.id, code: 'CAR' } } });
  assert.equal(car.priceKobo, 55_500);
});
