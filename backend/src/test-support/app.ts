import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { PrismaClient, type UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { requireDatabase, uniqueCode } from './db';

/**
 * Boots the real application over HTTP against a freshly created site.
 *
 * The app holds its own database connection, so these rows are COMMITTED,
 * not rolled back. Each call makes a new site with a unique "-test" code, so
 * test files never see each other's rows. `prisma migrate reset` on the test
 * database clears them.
 *
 * Passwords are generated per run and never printed.
 */

export interface TestUser {
  id: string;
  username: string;
  password: string;
  role: UserRole;
}

export interface TestApp {
  app: INestApplication;
  url: string;
  prisma: PrismaClient;
  siteId: string;
  siteCode: string;
  entryGateId: string;
  exitGateId: string;
  users: { admin: TestUser; entry: TestUser; exit: TestUser };
  /** A valid access token for this user at its CURRENT token_version. */
  accessToken(userId: string): Promise<string>;
  /** Signs arbitrary claims with the app's own secret. */
  sign(claims: Record<string, unknown>, expiresIn?: JwtSignOptions['expiresIn']): string;
  close(): Promise<void>;
}

export async function bootTestApp(): Promise<TestApp> {
  requireDatabase();
  process.env.JWT_SECRET ??= randomBytes(32).toString('hex');
  const siteCode = uniqueCode('app');
  process.env.SITE_CODE = siteCode;

  const prisma = new PrismaClient();
  const site = await prisma.site.create({ data: { code: siteCode } });
  await prisma.siteSetting.create({
    data: { siteId: site.id, displayName: 'Test Market', validityHours: 12 },
  });
  const entryGate = await prisma.gate.create({
    data: { siteId: site.id, code: 'ENTRY_1', name: 'Entry 1', direction: 'ENTRY' },
  });
  const exitGate = await prisma.gate.create({
    data: { siteId: site.id, code: 'EXIT_1', name: 'Exit 1', direction: 'EXIT' },
  });

  const makeUser = async (username: string, role: UserRole, gateId: string | null): Promise<TestUser> => {
    const password = randomBytes(18).toString('base64url');
    const row = await prisma.appUser.create({
      data: {
        siteId: site.id,
        username,
        name: username,
        role,
        gateId,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    return { id: row.id, username, password, role };
  };

  const users = {
    admin: await makeUser('admin', 'ADMIN', null),
    entry: await makeUser('entry.op', 'ENTRY_OPERATOR', entryGate.id),
    exit: await makeUser('exit.op', 'EXIT_OPERATOR', exitGate.id),
  };

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { configureApp } = await import('../app.setup');

  // abortOnError off: Nest would otherwise exit the process silently (logger is off) and
  // the test would report only 'test failed'.
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: false, abortOnError: false });
  let jwt: JwtService;
  try {
    jwt = app.get(JwtService);
    configureApp(app);
    await app.listen(0);
  } catch (error) {
    // Release the app and the client, or the failed test process never exits.
    await app.close();
    await prisma.$disconnect();
    throw error;
  }
  const { port } = app.getHttpServer().address() as AddressInfo;

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    prisma,
    siteId: site.id,
    siteCode,
    entryGateId: entryGate.id,
    exitGateId: exitGate.id,
    users,
    async accessToken(userId) {
      const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId } });
      return jwt.sign(
        { sub: user.id, siteId: user.siteId, role: user.role, typ: 'access', ver: user.tokenVersion },
        { expiresIn: '5m' },
      );
    },
    sign(claims, expiresIn: JwtSignOptions['expiresIn'] = '5m') {
      return jwt.sign(claims, { expiresIn });
    },
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** fetch with JSON in and out. */
export async function call(
  t: TestApp,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${t.url}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}
