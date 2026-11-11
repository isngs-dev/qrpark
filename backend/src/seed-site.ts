import { PrismaClient } from '@prisma/client';
import { AuthService } from './auth/auth.service';
import { normaliseUsername } from './users/user-rules';
import { assertSeedPassword } from './seed-passwords';

/**
 * Creates the one site row this deployment serves, its settings row, and
 * optionally the first admin so someone can sign in.
 *
 *   SITE_CODE=... [SITE_NAME=...] node dist/seed-site.js
 *   ... SEED_ADMIN_USERNAME=... SEED_ADMIN_PASSWORD=... [SEED_ADMIN_NAME=...] node dist/seed-site.js
 *
 * On the server it runs in the compose "seed" service (the api image, on the
 * internal network: no outside database connection), which alone receives the
 * SEED_* variables; they are deleted from .env afterwards (docs/07).
 *
 * Copied from eparking backend/src/seed-site.ts and adapted: a site_setting
 * row, a username, and the shared password rule.
 *
 * Only identity and a starting point go here. Never changes a row that
 * exists, so it is safe to run on every deploy. Prices, categories and gates
 * are edited in the Admin Portal.
 *
 * A ticket is valid on its day of issue only (Africa/Lagos): there is no
 * validity setting (docs/05-known-issues.md T1, closed).
 *
 * Not audited: there is no actor yet. The password is never printed. A weak
 * or missing SEED_ADMIN_PASSWORD (seed-passwords.ts) is refused before
 * anything is read or written; an existing admin's password is never changed.
 */

export async function seedSite(options: {
  prisma: PrismaClient;
  env: Record<string, string | undefined>;
  print: (line: string) => void;
}): Promise<{ siteId: string; adminCreated: boolean }> {
  const { prisma, env, print } = options;
  const code = env.SITE_CODE;
  if (!code) throw new Error('SITE_CODE must be set');

  // Validate everything before writing anything.
  const username = env.SEED_ADMIN_USERNAME !== undefined ? normaliseUsername(env.SEED_ADMIN_USERNAME) : undefined;
  const password = env.SEED_ADMIN_PASSWORD;
  if ((username === undefined) !== (password === undefined)) {
    throw new Error('Set both SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD, or neither');
  }
  if (username !== undefined) assertSeedPassword('SEED_ADMIN_PASSWORD', password, username);

  let site = await prisma.site.findUnique({ where: { code } });
  if (site) print(`  kept     site ${code} (already there, not changed)`);
  else {
    site = await prisma.site.create({ data: { code } });
    print(`  created  site ${code}`);
  }

  const setting = await prisma.siteSetting.findUnique({ where: { siteId: site.id } });
  if (setting) print(`  kept     settings (name "${setting.displayName}")`);
  else {
    const displayName = (env.SITE_NAME ?? code).trim() || code;
    await prisma.siteSetting.create({
      data: { siteId: site.id, displayName },
    });
    print(`  created  settings (name "${displayName}")`);
  }

  let adminCreated = false;
  if (username !== undefined && password !== undefined) {
    const existing = await prisma.appUser.findFirst({ where: { siteId: site.id, username, deletedAt: null } });
    if (existing) print(`  kept     admin ${username} (password not changed)`);
    else {
      await prisma.appUser.create({
        data: {
          siteId: site.id,
          username,
          name: env.SEED_ADMIN_NAME?.trim() || 'Administrator',
          role: 'ADMIN',
          passwordHash: await AuthService.hash(password),
        },
      });
      adminCreated = true;
      print(`  created  admin ${username} (password from SEED_ADMIN_PASSWORD, not shown)`);
    }
  } else {
    print('  skipped  admin (no SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD)');
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
