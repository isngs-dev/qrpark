import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { call, type TestApp, type TestUser } from './app';
import { fakeTicketNumber, fakeToken } from './db';

/** Helpers for the validate and check tests. */

export const DEVICE = 'test-device-1';

/**
 * An ACTIVE ticket on a SUCCESS payment, written straight to the database.
 * `expired` moves the whole ticket 13 hours into the past (valid 12 h), so
 * valid_until = paid_at + hours still holds.
 */
export async function issueTicket(t: TestApp, opts: { expired?: boolean; categoryCode?: string } = {}) {
  const code = opts.categoryCode ?? 'SCANCAR';
  const category =
    (await t.prisma.vehicleCategory.findUnique({ where: { siteId_code: { siteId: t.siteId, code } } })) ??
    (await t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code, name: 'Car', priceKobo: 50_000 } }));
  const paidAt = new Date(Date.now() - (opts.expired ? 13 : 0) * 3600_000);
  const payment = await t.prisma.payment.create({
    data: {
      siteId: t.siteId,
      reference: `QRP_${randomBytes(12).toString('hex')}`,
      idempotencyKey: randomBytes(16).toString('hex'),
      operatorId: t.users.entry.id,
      gateId: t.entryGateId,
      categoryId: category.id,
      categoryCode: code,
      categoryName: 'Car',
      amountKobo: 50_000,
      status: 'SUCCESS',
      paidAt,
    },
  });
  return t.prisma.ticket.create({
    data: {
      siteId: t.siteId,
      paymentId: payment.id,
      token: fakeToken(),
      ticketNumber: fakeTicketNumber(),
      operatorId: t.users.entry.id,
      gateId: t.entryGateId,
      categoryName: 'Car',
      amountKobo: 50_000,
      customerName: 'Ada Obi',
      paymentReference: payment.reference,
      paidAt,
      validityHours: 12,
      validUntil: new Date(paidAt.getTime() + 12 * 3600_000),
    },
  });
}

export async function addOperator(
  t: TestApp,
  username: string,
  role: 'ENTRY_OPERATOR' | 'EXIT_OPERATOR',
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
