import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from './audit/audit.service';
import { ConfigService } from './config/config.service';
import { UsersService } from './users/users.service';
import { TEST_ACCOUNTS, TEST_CATEGORIES, TEST_GATES, generatePassword, naira, testSiteProblem } from './seed-test-data.rules';

/**
 * Test data for a TEST site only:
 *
 *   SITE_CODE=garki-test node dist/seed-test-data.js
 *
 * Copied from eparking backend/src/seed-test-data.ts and adapted.
 *
 * Rules, each tested in seed-test-data.lifecycle.test.ts:
 *  - Refuses any site whose code does not end in "-test", before it reads or
 *    writes anything.
 *  - Never changes or overwrites a record: anything that exists is kept and
 *    reported as kept. A second run creates nothing.
 *  - Writes through the portal's own services, so the data obeys the same
 *    validation (integer kobo, gate direction, password length) and every
 *    change is audited under the site's first admin.
 *  - A new account's password is printed once, here, and stored nowhere but
 *    as its hash.
 *
 * ALL AMOUNTS ARE TEST VALUES.
 */

export interface SeedOutcome {
  created: string[];
  kept: string[];
}

export async function seedTestData(options: {
  prisma: PrismaClient;
  siteCode: string | undefined;
  print: (line: string) => void;
}): Promise<SeedOutcome> {
  const { prisma, siteCode, print } = options;

  // FIRST, before any read or write.
  const problem = testSiteProblem(siteCode);
  if (problem) throw new Error(problem);
  const code = siteCode!;

  const site = await prisma.site.findUnique({ where: { code } });
  if (!site) throw new Error(`No site "${code}". Run the site seed first: node dist/seed-site.js`);

  // Every change is audited, and an audit row names a person.
  const admin = await prisma.appUser.findFirst({
    where: { siteId: site.id, role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error(
      `No active admin on "${code}" to record these changes under. Create one first: ` +
        'ADMIN_USERNAME=... ADMIN_PASSWORD=... node dist/seed-site.js',
    );
  }

  const siteStub = { getId: async () => site.id, code } as never;
  const audit = new AuditService(prisma as never, siteStub);
  const config = new ConfigService(prisma as never, siteStub, audit);
  // The seed never resets a password, so the sign-in throttle is never asked to clear anything.
  const noThrottle = { clearUser: async () => undefined } as never;
  const users = new UsersService(prisma as never, siteStub, audit, noThrottle);

  const outcome: SeedOutcome = { created: [], kept: [] };
  const made = (what: string) => {
    outcome.created.push(what);
    print(`  created  ${what}`);
  };
  const kept = (what: string) => {
    outcome.kept.push(what);
    print(`  kept     ${what} (already there, not changed)`);
  };

  print(`Test data for site "${code}" - recorded in the audit log as ${admin.username}`);
  print('All amounts below are TEST VALUES.');

  // ---------------------------------------------------------------- gates
  const gateIds = new Map<string, string>();
  for (const gate of TEST_GATES) {
    const existing = await prisma.gate.findUnique({ where: { siteId_code: { siteId: site.id, code: gate.code } } });
    if (existing) {
      gateIds.set(gate.code, existing.id);
      kept(`gate ${gate.code}`);
    } else {
      const created = await config.createGate(gate, admin.id);
      gateIds.set(gate.code, created.id);
      made(`gate ${gate.code} (${gate.direction})`);
    }
  }

  // ----------------------------------------------- categories and prices
  for (const category of TEST_CATEGORIES) {
    const existing = await prisma.vehicleCategory.findUnique({
      where: { siteId_code: { siteId: site.id, code: category.code } },
    });
    if (existing) kept(`category ${category.code} (${naira(existing.priceKobo)})`);
    else {
      await config.createCategory(category, admin.id);
      made(`category ${category.code} ${naira(category.priceKobo)} - TEST VALUE`);
    }
  }

  // ------------------------------------------------------ test accounts
  const passwords: Array<{ username: string; password: string }> = [];
  for (const account of TEST_ACCOUNTS) {
    const existing = await prisma.appUser.findFirst({
      where: { siteId: site.id, username: account.username, deletedAt: null },
    });
    if (existing) {
      kept(`account ${account.username} - password not shown again`);
      continue;
    }
    const password = generatePassword();
    await users.create(
      { username: account.username, name: account.name, role: account.role, gateId: gateIds.get(account.gateCode)!, password },
      admin.id,
    );
    made(`account ${account.username} (${account.role} at ${account.gateCode})`);
    passwords.push({ username: account.username, password });
  }

  if (passwords.length > 0) {
    print('');
    print('NEW PASSWORDS - shown this once only. Send each privately to the tester it is for,');
    print('then clear this screen.');
    for (const { username, password } of passwords) print(`  ${username}  password: ${password}`);
  } else {
    print('No new accounts: existing passwords are not shown again. Reset one in the portal if it is lost.');
  }

  print(`Done: ${outcome.created.length} created, ${outcome.kept.length} kept.`);
  return outcome;
}

async function main() {
  // The services log each step at info level. Warnings and errors only here,
  // so the one-time password block is not lost among them.
  Logger.overrideLogger(['warn', 'error']);
  const prisma = new PrismaClient();
  try {
    await seedTestData({ prisma, siteCode: process.env.SITE_CODE, print: (line) => console.log(line) });
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a script, never when imported by a test.
if (require.main === module) void main();
