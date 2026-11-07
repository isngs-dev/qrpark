import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Shared by the database tests. Not a test file itself.
 *
 * Tests need DATABASE_URL pointing at a migrated database they may write to
 * (qrpark_test locally, the service container in CI). They fail rather than
 * skip without one: a skipped database test proves nothing.
 */

export function requireDatabase(): void {
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'DATABASE_URL must be set (a migrated test database)');
  // The HTTP tests COMMIT rows. Outside CI, refuse any database not named as
  // a test database, so `npm test` can never write into a dev or real one.
  const name = new URL(url).pathname.slice(1);
  assert.ok(
    process.env.CI === 'true' || name.endsWith('_test'),
    `Refusing to run tests against database "${name}": its name must end in "_test" (CI excepted)`,
  );
}

class Rollback extends Error {}

/**
 * Runs `fn` in a transaction that is always rolled back, and returns the
 * database's error message, or null when every statement succeeded.
 */
export async function attemptInRollback(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<string | null> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return null;
    return (error as Error).message;
  }
  return null;
}

/** Asserts the database refused with the named constraint or trigger. */
export function assertRefusedBy(message: string | null, name: string): void {
  assert.ok(message !== null, `expected the database to refuse with "${name}", but it accepted`);
  assert.ok(message.includes(name), `expected "${name}" in the error, got: ${message}`);
}

/**
 * Asserts a unique index refused the write. Postgres names the key columns
 * ("Key (token)=(...) already exists") but Prisma's raw error drops the
 * index name, so the columns identify the index. Where two partial indexes
 * share columns (one SUCCESS / one PENDING per ticket) the test's own rows
 * decide which one can fire, and each has its own fail-when-removed run.
 */
export function assertUniqueRefused(message: string | null, keyColumns: string): void {
  assert.ok(message !== null, `expected a unique violation on (${keyColumns}), but the database accepted`);
  assert.ok(message.includes('Code: `23505`'), `expected unique_violation (23505), got: ${message}`);
  assert.ok(message.includes(`Key (${keyColumns})=`), `expected key (${keyColumns}), got: ${message}`);
}

export function uniqueCode(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex')}-test`;
}

/** A token of the stored shape: 32 random bytes, base64url, 43 characters. */
export function fakeToken(): string {
  return randomBytes(32).toString('base64url');
}

const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function fakeTicketNumber(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => TICKET_ALPHABET[b % TICKET_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export interface Fixture {
  siteId: string;
  entryGateId: string;
  boothGateId: string;
  exitGateId: string;
  adminId: string;
  entryOpId: string;
  boothOpId: string;
  exitOpId: string;
  categoryId: string;
}

/** A complete small site, written through the client inside `tx`. */
export async function buildFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  const site = await tx.site.create({ data: { code: uniqueCode('fx') } });
  await tx.siteSetting.create({ data: { siteId: site.id, displayName: 'Fixture Market' } });
  const gate = (code: string, direction: 'ENTRY' | 'BOOTH' | 'EXIT') =>
    tx.gate.create({ data: { siteId: site.id, code, name: code, direction } });
  const entryGate = await gate('ENTRY_1', 'ENTRY');
  const boothGate = await gate('BOOTH_1', 'BOOTH');
  const exitGate = await gate('EXIT_1', 'EXIT');
  // Not a real hash: these rows never sign in.
  const user = (
    username: string,
    role: 'ADMIN' | 'ENTRY_OPERATOR' | 'PAYMENT_OPERATOR' | 'EXIT_OPERATOR',
    gateId: string | null,
  ) => tx.appUser.create({ data: { siteId: site.id, username, name: username, passwordHash: 'x', role, gateId } });
  const admin = await user('admin', 'ADMIN', null);
  const entryOp = await user('entry.op', 'ENTRY_OPERATOR', entryGate.id);
  const boothOp = await user('booth.op', 'PAYMENT_OPERATOR', boothGate.id);
  const exitOp = await user('exit.op', 'EXIT_OPERATOR', exitGate.id);
  const category = await tx.vehicleCategory.create({
    data: { siteId: site.id, code: 'CAR', name: 'Car', priceKobo: 50_000 },
  });
  return {
    siteId: site.id,
    entryGateId: entryGate.id,
    boothGateId: boothGate.id,
    exitGateId: exitGate.id,
    adminId: admin.id,
    entryOpId: entryOp.id,
    boothOpId: boothOp.id,
    exitOpId: exitOp.id,
    categoryId: category.id,
  };
}

/**
 * A ticket inserted with RAW SQL, so nothing in the Prisma client stands
 * between the row and the database's own rules. UNPAID and NOT_VALIDATED
 * unless overridden; valid_until is whatever the database decides.
 */
export async function rawInsertTicket(
  tx: Prisma.TransactionClient,
  fx: Fixture,
  o: {
    token?: string;
    ticketNumber?: string;
    idempotencyKey?: string;
    feeKobo?: number;
    issuedAt?: string;
    validUntil?: string;
    paymentStatus?: string;
    validationStatus?: string;
  } = {},
): Promise<{ id: string; validUntil: Date; issuedAt: Date }> {
  const cols = ['id', 'site_id', 'idempotency_key', 'token', 'ticket_number', 'operator_id', 'gate_id', 'device_ref',
    'category_id', 'category_code', 'category_name', 'fee_kobo', 'updated_at'];
  const vals = ['gen_random_uuid()', '$1::uuid', '$2', '$3', '$4', '$5::uuid', '$6::uuid', `'test-device'`,
    '$7::uuid', `'CAR'`, `'Car'`, '$8::int', 'now()'];
  const params: unknown[] = [
    fx.siteId,
    o.idempotencyKey ?? randomBytes(16).toString('hex'),
    o.token ?? fakeToken(),
    o.ticketNumber ?? fakeTicketNumber(),
    fx.entryOpId,
    fx.entryGateId,
    fx.categoryId,
    o.feeKobo ?? 50_000,
  ];
  const add = (col: string, cast: string, value: unknown) => {
    params.push(value);
    cols.push(col);
    vals.push(`$${params.length}::${cast}`);
  };
  if (o.issuedAt !== undefined) add('issued_at', 'timestamptz', o.issuedAt);
  if (o.validUntil !== undefined) add('valid_until', 'timestamptz', o.validUntil);
  if (o.paymentStatus !== undefined) add('payment_status', 'ticket_payment_status', o.paymentStatus);
  if (o.validationStatus !== undefined) add('validation_status', 'ticket_validation_status', o.validationStatus);
  const rows = await tx.$queryRawUnsafe<Array<{ id: string; valid_until: Date; issued_at: Date }>>(
    `INSERT INTO ticket (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id::text, valid_until, issued_at`,
    ...params,
  );
  return { id: rows[0].id, validUntil: rows[0].valid_until, issuedAt: rows[0].issued_at };
}

/** A payment row for a ticket, with RAW SQL. CASH defaults to SUCCESS, CARD to PENDING. */
export async function rawInsertPayment(
  tx: Prisma.TransactionClient,
  fx: Fixture,
  ticketId: string,
  o: {
    method?: 'CASH' | 'CARD';
    status?: string;
    amountKobo?: number;
    reference?: string;
    idempotencyKey?: string;
    operatorId?: string;
    paystackEvent?: boolean;
  } = {},
): Promise<{ id: string }> {
  const method = o.method ?? 'CARD';
  const status = o.status ?? (method === 'CASH' ? 'SUCCESS' : 'PENDING');
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO payment (id, site_id, ticket_id, method, reference, idempotency_key, operator_id, gate_id, device_ref,
       amount_kobo, status, paid_at, paystack_event, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::payment_method, $4, $5, $6::uuid, $7::uuid, 'test-device',
       $8::int, $9::payment_status, CASE WHEN $9 = 'SUCCESS' THEN now() END,
       CASE WHEN $10 THEN '{"reference":"x"}'::jsonb END, now())
     RETURNING id::text`,
    fx.siteId,
    ticketId,
    method,
    o.reference ?? `QRP_${randomBytes(12).toString('hex')}`,
    o.idempotencyKey ?? randomBytes(16).toString('hex'),
    o.operatorId ?? fx.boothOpId,
    fx.boothGateId,
    o.amountKobo ?? 50_000,
    status,
    o.paystackEvent ?? false,
  );
  return rows[0];
}

/** UNPAID -> PAID through the given payment, with RAW SQL. */
export async function rawMarkPaid(tx: Prisma.TransactionClient, ticketId: string, paymentId: string) {
  await tx.$executeRawUnsafe(
    `UPDATE ticket SET payment_status = 'PAID', paid_payment_id = $2::uuid, paid_at = now() WHERE id = $1::uuid`,
    ticketId,
    paymentId,
  );
}

/** A ticket paid in cash: the usual starting point for exit and scan rules. */
export async function rawPaidTicket(tx: Prisma.TransactionClient, fx: Fixture, o: Parameters<typeof rawInsertTicket>[2] = {}) {
  const ticket = await rawInsertTicket(tx, fx, o);
  const payment = await rawInsertPayment(tx, fx, ticket.id, { method: 'CASH' });
  await rawMarkPaid(tx, ticket.id, payment.id);
  return { ...ticket, paymentId: payment.id };
}
