import { randomBytes, randomUUID } from 'node:crypto';
import { call, type TestApp } from './app';
import { fakeTicketNumber, fakeToken } from './db';

/**
 * Tickets in any state, for the HTTP tests, written with RAW SQL (committed,
 * like everything bootTestApp makes). The database's own rules still apply:
 * PAID goes through a SUCCESS payment of the ticket's own, VALIDATED through
 * PAID. An earlier-day ticket is inserted with an explicit issued_at, the
 * only way one can exist (the API never sets a time).
 */

export const DEVICE = 'test-device-1';
export const TEST_CATEGORY = 'TCAR';
export const TEST_FEE = 50_000;

export async function ensureCategory(t: TestApp, code = TEST_CATEGORY, priceKobo = TEST_FEE) {
  const existing = await t.prisma.vehicleCategory.findUnique({ where: { siteId_code: { siteId: t.siteId, code } } });
  return existing ?? t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code, name: 'Car', priceKobo } });
}

export interface MadeTicket {
  id: string;
  token: string;
  ticketNumber: string;
  feeKobo: number;
  validUntil: Date;
  paymentId: string | null;
}

export async function makeTicket(
  t: TestApp,
  o: {
    /** A day in the past, e.g. '2026-11-01T10:00:00Z'. Default: now. */
    issuedAt?: string;
    paid?: false | 'CASH' | 'CARD';
    validated?: boolean;
    ticketNumber?: string;
  } = {},
): Promise<MadeTicket> {
  const category = await ensureCategory(t);
  const token = fakeToken();
  const ticketNumber = o.ticketNumber ?? fakeTicketNumber();
  const rows = await t.prisma.$queryRawUnsafe<Array<{ id: string; valid_until: Date }>>(
    `INSERT INTO ticket (id, site_id, idempotency_key, token, ticket_number, operator_id, gate_id, device_ref,
       category_id, category_code, category_name, fee_kobo, issued_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, 'test-entry-device',
       $7::uuid, $8, 'Car', $9::int, COALESCE($10::timestamptz, now()), now())
     RETURNING id::text, valid_until`,
    t.siteId,
    randomUUID(),
    token,
    ticketNumber,
    t.users.entry.id,
    t.entryGateId,
    category.id,
    category.code,
    category.priceKobo,
    o.issuedAt ?? null,
  );
  const ticket: MadeTicket = {
    id: rows[0].id,
    token,
    ticketNumber,
    feeKobo: category.priceKobo,
    validUntil: rows[0].valid_until,
    paymentId: null,
  };
  if (o.paid) ticket.paymentId = await payRaw(t, ticket, o.paid);
  if (o.validated) {
    await t.prisma.$executeRawUnsafe(
      `UPDATE ticket SET validation_status = 'VALIDATED', validated_at = now(), validated_gate_id = $2::uuid,
         validated_by_id = $3::uuid WHERE id = $1::uuid`,
      ticket.id,
      t.exitGateId,
      t.users.exit.id,
    );
  }
  return ticket;
}

/** A SUCCESS payment of the ticket's own, and the ticket PAID through it. */
export async function payRaw(t: TestApp, ticket: { id: string; feeKobo: number }, method: 'CASH' | 'CARD') {
  const rows = await t.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO payment (id, site_id, ticket_id, method, reference, idempotency_key, operator_id, gate_id, device_ref,
       amount_kobo, status, paid_at, paystack_event, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::payment_method, $4, $5, $6::uuid, $7::uuid, 'test-booth-device',
       $8::int, 'SUCCESS', now(), CASE WHEN $3 = 'CARD' THEN '{"reference":"x"}'::jsonb END, now())
     RETURNING id::text`,
    t.siteId,
    ticket.id,
    method,
    `QRP_${randomBytes(12).toString('hex')}`,
    randomUUID(),
    t.users.booth.id,
    t.boothGateId,
    ticket.feeKobo,
  );
  await t.prisma.$executeRawUnsafe(
    `UPDATE ticket SET payment_status = 'PAID', paid_payment_id = $2::uuid, paid_at = now() WHERE id = $1::uuid`,
    ticket.id,
    rows[0].id,
  );
  return rows[0].id;
}

/** Calls with a signed-in user and the X-Device-Id header (null: no header). */
export async function as(
  t: TestApp,
  userId: string,
  method: string,
  path: string,
  body?: unknown,
  opts: { device?: string | null; rawBody?: string } = {},
) {
  const device = opts.device === undefined ? DEVICE : opts.device;
  return call(t, method, path, {
    token: await t.accessToken(userId),
    ...(opts.rawBody !== undefined ? { rawBody: opts.rawBody } : body !== undefined ? { body } : {}),
    headers: device === null ? {} : { 'x-device-id': device },
  });
}

export const newKey = () => randomUUID();

/** Moves an operator to another location by raw SQL (wrong-kind tests). */
export async function moveOperator(t: TestApp, userId: string, gateId: string) {
  await t.prisma.$executeRawUnsafe(`UPDATE app_user SET gate_id = $1::uuid WHERE id = $2::uuid`, gateId, userId);
}

/** Every row count of the site, for "nothing was written". */
export async function siteCounts(t: TestApp) {
  const where = { siteId: t.siteId };
  return {
    ticket: await t.prisma.ticket.count({ where }),
    payment: await t.prisma.payment.count({ where }),
    scanEvent: await t.prisma.scanEvent.count({ where }),
    auditLog: await t.prisma.auditLog.count({ where }),
    paidTickets: await t.prisma.ticket.count({ where: { ...where, paymentStatus: 'PAID' } }),
    validatedTickets: await t.prisma.ticket.count({ where: { ...where, validationStatus: 'VALIDATED' } }),
  };
}
