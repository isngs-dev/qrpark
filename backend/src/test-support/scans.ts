import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { call, type TestApp, type TestUser } from './app';
import { makeTicket } from './tickets';

/** Helpers for the validate and check tests. */

export const DEVICE = 'test-device-1';

/**
 * A ticket for the scan tests: PAID in cash unless `unpaid`; `expired` issues
 * it on an earlier day (valid_until is the database's end of that day).
 */
export async function issueTicket(t: TestApp, opts: { expired?: boolean; unpaid?: boolean; validated?: boolean } = {}) {
  return makeTicket(t, {
    paid: opts.unpaid ? false : 'CASH',
    validated: opts.validated,
    issuedAt: opts.expired ? '2026-11-01T10:00:00Z' : undefined,
  });
}

export async function addOperator(
  t: TestApp,
  username: string,
  role: 'ENTRY_OPERATOR' | 'PAYMENT_OPERATOR' | 'EXIT_OPERATOR',
  gateId: string,
): Promise<TestUser> {
  const password = randomBytes(18).toString('base64url');
  const row = await t.prisma.appUser.create({
    data: {
      siteId: t.siteId,
      username,
      name: username,
      role,
      gateId,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  return { id: row.id, username, password, role };
}

/** POST /tickets/validate or /tickets/check as this user, with a device header. */
export async function scan(
  t: TestApp,
  route: 'validate' | 'check',
  userId: string,
  body: unknown,
  opts: { device?: string | null; rawBody?: string } = {},
) {
  const device = opts.device === undefined ? DEVICE : opts.device;
  return call(t, 'POST', `/tickets/${route}`, {
    token: await t.accessToken(userId),
    ...(opts.rawBody !== undefined ? { rawBody: opts.rawBody } : { body }),
    headers: device === null ? {} : { 'x-device-id': device },
  });
}

/** Everything about a ticket row, for before/after comparison. */
export async function ticketRow(t: TestApp, id: string) {
  return t.prisma.ticket.findUniqueOrThrow({ where: { id } });
}

/** Row counts of every table for this site (site_setting has one row, keyed by site). */
export async function siteCounts(t: TestApp) {
  const where = { siteId: t.siteId };
  return {
    ticket: await t.prisma.ticket.count({ where }),
    payment: await t.prisma.payment.count({ where }),
    scanEvent: await t.prisma.scanEvent.count({ where }),
    auditLog: await t.prisma.auditLog.count({ where }),
    appUser: await t.prisma.appUser.count({ where }),
    gate: await t.prisma.gate.count({ where }),
    vehicleCategory: await t.prisma.vehicleCategory.count({ where }),
  };
}
