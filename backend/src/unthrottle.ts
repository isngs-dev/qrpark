import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { RedisThrottleStore } from './auth/login-throttle-redis';
import { throttleKeys } from './auth/login-throttle';

/**
 * Clears a username's sign-in throttle counts in Redis (Hardening H1). Written new.
 *
 *   npm run unthrottle -- <username>      (DATABASE_URL, REDIS_URL, JWT_SECRET, SITE_CODE)
 *
 * For an account kept blocked by failures from many addresses. On the server
 * it runs inside the api container (docs/07-deploy-digitalocean.md); the other
 * exits are the 15-minute expiry and an admin resetting the password (which
 * clears the same counts). Prints a count only, never the username. The backend's
 * in-memory fallback (used only while Redis is down) is not reached from here.
 */
export async function unthrottle(username: string, env: NodeJS.ProcessEnv): Promise<number> {
  if (!env.JWT_SECRET || !env.SITE_CODE) throw new Error('Set JWT_SECRET and SITE_CODE');
  const prisma = new PrismaClient(env.DATABASE_URL ? { datasources: { db: { url: env.DATABASE_URL } } } : undefined);
  const redis = new Redis(env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 1 });
  try {
    const site = await prisma.site.findUnique({ where: { code: env.SITE_CODE } });
    if (!site) throw new Error('No site with that SITE_CODE');
    const { user } = throttleKeys(env.JWT_SECRET, site.id, username, '-');
    return await new RedisThrottleStore(redis).clearUser(user);
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const username = process.argv[2];
  if (!username) {
    process.stderr.write('Usage: npm run unthrottle -- <username>\n');
    process.exit(2);
  }
  unthrottle(username, process.env).then(
    (n) => process.stdout.write(`Cleared ${n} sign-in throttle count(s) for that username.\n`),
    (e: Error) => {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    },
  );
}
