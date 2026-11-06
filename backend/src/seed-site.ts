import { PrismaClient } from '@prisma/client';
import { AuthService } from './auth/auth.service';
import { assertPassword, normaliseUsername } from './users/user-rules';

/**
 * Creates the one site row this deployment serves, its settings row, and
 * optionally the first admin so someone can sign in.
 *
 *   SITE_CODE=... [SITE_NAME=...] node dist/seed-site.js
 *   ... ADMIN_USERNAME=... ADMIN_PASSWORD=... [ADMIN_NAME=...] node dist/seed-site.js
 *
 * Copied from eparking backend/src/seed-site.ts and adapted: a site_setting
 * row, a username, and the shared password rule.
 *
 * Only identity and a starting point go here. Never changes a row that
 * exists, so it is safe to run on every deploy. Prices, categories and gates
 * are edited in the Admin Portal.
 *
 * validity_hours starts at 12: ASSUMED FOR TESTING. Confirm before go-live
 * (docs/05-known-issues.md T1).
 *
 * Not audited: there is no actor yet. The password is never printed.
 */

export const DEFAULT_VALIDITY_HOURS = 12;

export async function seedSite(options: {
  prisma: PrismaClient;
  env: Record<string, string | undefined>;
  print: (line: string) => void;
}): Promise<{ siteId: string; adminCreated: boolean }> {
  const { prisma, env, print } = options;
  const code = env.SITE_CODE;
  if (!code) throw new Error('SITE_CODE must be set');

  // Validate everything before writing anything.
  const username = env.ADMIN_USERNAME !== undefined ? normaliseUsername(env.ADMIN_USERNAME) : undefined;
  const password = env.ADMIN_PASSWORD;
  if ((username === undefined) !== (password === undefined)) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD, or neither');
  }
  if (password !== undefined) assertPassword(password);

  let site = await prisma.site.findUnique({ where: { code } });
  if (site) print(`  kept     site ${code} (already there, not changed)`);
  else {
    site = await prisma.site.create({ data: { code } });
    print(`  created  site ${code}`);
  }

  const setting = await prisma.siteSetting.findUnique({ where: { siteId: site.id } });
  if (setting) print(`  kept     settings (validity ${setting.validityHours} h, name "${setting.displayName}")`);
  else {
    const displayName = (env.SITE_NAME ?? code).trim() || code;
    await prisma.siteSetting.create({
      data: { siteId: site.id, displayName, validityHours: DEFAULT_VALIDITY_HOURS },
    });
    print(`  created  settings (validity ${DEFAULT_VALIDITY_HOURS} h - ASSUMED, confirm before go-live; name "${displayName}")`);
  }

  let adminCreated = false;
  if (username !== undefined && password !== undefined) {
    const existing = await prisma.appUser.findUnique({
      where: { siteId_username: { siteId: site.id, username } },
    });
    if (existing) print(`  kept     admin ${username} (password not changed)`);
    else {
      await prisma.appUser.create({
        data: {
          siteId: site.id,
          username,
          name: env.ADMIN_NAME?.trim() || 'Administrator',
          role: 'ADMIN',
          passwordHash: await AuthService.hash(password),
        },
      });
      adminCreated = true;
      print(`  created  admin ${username} (password from ADMIN_PASSWORD, not shown)`);
    }
  } else {
    print('  skipped  admin (no ADMIN_USERNAME / ADMIN_PASSWORD)');
  }

  return { siteId: site.id, adminCreated };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(`Seeding site "${process.env.SITE_CODE ?? ''}"`);
    await seedSite({ prisma, env: process.env, print: (line) => console.log(line) });
    console.log('Done.');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a script, never when imported by a test.
if (require.main === module) void main();
