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
  exitGateId: string;
  adminId: string;
  entryOpId: string;
  exitOpId: string;
  categoryId: string;
}

/** A complete small site, written through the client inside `tx`. */
export async function buildFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  const site = await tx.site.create({ data: { code: uniqueCode('fx') } });
  await tx.siteSetting.create({
    data: { siteId: site.id, displayName: 'Fixture Market', validityHours: 12 },
  });
  const entryGate = await tx.gate.create({
    data: { siteId: site.id, code: 'ENTRY_1', name: 'Entry 1', direction: 'ENTRY' },
  });
  const exitGate = await tx.gate.create({
    data: { siteId: site.id, code: 'EXIT_1', name: 'Exit 1', direction: 'EXIT' },
  });
  // Not a real hash: these rows never sign in.
  const user = (username: string, role: 'ADMIN' | 'ENTRY_OPERATOR' | 'EXIT_OPERATOR', gateId: string | null) =>
    tx.appUser.create({
      data: { siteId: site.id, username, name: username, passwordHash: 'x', role, gateId },
    });
  const admin = await user('admin', 'ADMIN', null);
  const entryOp = await user('entry.op', 'ENTRY_OPERATOR', entryGate.id);
  const exitOp = await user('exit.op', 'EXIT_OPERATOR', exitGate.id);
  const category = await tx.vehicleCategory.create({
    data: { siteId: site.id, code: 'CAR', name: 'Car', priceKobo: 50_000 },
  });
  return {
    siteId: site.id,
    entryGateId: entryGate.id,
    exitGateId: exitGate.id,
    adminId: admin.id,
    entryOpId: entryOp.id,
    exitOpId: exitOp.id,
    categoryId: category.id,
  };
}

/**
 * Asserts a unique index refused the write. Postgres names the key columns
 * ("Key (token)=(...) already exists") but Prisma's raw error drops the
 * index name, so the columns identify the index: every unique key in this
 * schema covers a different set of columns.
 */
export function assertUniqueRefused(message: string | null, keyColumns: string): void {
  assert.ok(message !== null, `expected a unique violation on (${keyColumns}), but the database accepted`);
  assert.ok(message.includes('Code: `23505`'), `expected unique_violation (23505), got: ${message}`);
  assert.ok(message.includes(`Key (${keyColumns})=`), `expected key (${keyColumns}), got: ${message}`);
}

/** A payment row inserted with RAW SQL, with sensible defaults. */
export async function insertPayment(
  tx: Prisma.TransactionClient,
  fx: Fixture,
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED',
  overrides: { reference?: string; idempotencyKey?: string; operatorId?: string } = {},
): Promise<{ id: string }> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO payment (id, site_id, reference, idempotency_key, operator_id, gate_id, category_id,
       category_code, category_name, amount_kobo, status, paid_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid,
       'CAR', 'Car', 50000, $7::payment_status, CASE WHEN $7 = 'SUCCESS' THEN now() END, now())
     RETURNING id::text`,
    fx.siteId,
    overrides.reference ?? `QRP-${randomBytes(8).toString('hex')}`,
    overrides.idempotencyKey ?? randomBytes(16).toString('hex'),
    overrides.operatorId ?? fx.entryOpId,
    fx.entryGateId,
    fx.categoryId,
    status,
  );
  return rows[0];
}

/**
 * Inserts a ticket with RAW SQL, so nothing in the Prisma client can stand
 * between the row and the database's own rules.
 */
export async function rawInsertTicket(
  tx: Prisma.TransactionClient,
  fx: Fixture,
  paymentId: string,
  overrides: { token?: string; ticketNumber?: string } = {},
) {
  const paidAt = new Date();
  await tx.$executeRawUnsafe(
    `INSERT INTO ticket (id, site_id, payment_id, token, ticket_number,
       operator_id, gate_id, category_name, amount_kobo, payment_reference,
       paid_at, validity_hours, valid_until, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
       $5::uuid, $6::uuid, 'Car', 50000, 'REF',
       $7::timestamptz, 12, $7::timestamptz + interval '12 hours', now())`,
    fx.siteId,
    paymentId,
    overrides.token ?? fakeToken(),
    overrides.ticketNumber ?? fakeTicketNumber(),
    fx.entryOpId,
    fx.entryGateId,
    paidAt.toISOString(),
  );
}
