import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  assertRefusedBy,
  assertUniqueRefused,
  attemptInRollback,
  buildFixture,
  fakeTicketNumber,
  fakeToken,
  insertPayment,
  rawInsertTicket,
  requireDatabase,
} from '../test-support/db';

/**
 * The rules the DATABASE enforces, independent of any service code: each
 * test writes past the application with raw SQL or a bare client call and
 * expects the named constraint or trigger to refuse it. Every test runs in a
 * transaction that is always rolled back.
 *
 * Each rule also has a positive control, so a refusal cannot come from a
 * broken fixture.
 */

requireDatabase();
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

// ------------------------------------------------------------ site reference

test('every table except site carries a NOT NULL site_id with a foreign key to site', async () => {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('site', '_prisma_migrations')`;
  assert.ok(tables.length >= 8, `expected at least 8 tables, saw ${tables.length}`);

  for (const { table_name } of tables) {
    const column = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table_name} AND column_name = 'site_id'`;
    assert.equal(column.length, 1, `${table_name} has no site_id`);
    assert.equal(column[0].is_nullable, 'NO', `${table_name}.site_id is nullable`);

    const fk = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.conrelid = ${table_name}::regclass
        AND c.confrelid = 'site'::regclass AND a.attname = 'site_id'`;
    assert.equal(Number(fk[0].n), 1, `${table_name}.site_id has no foreign key to site`);
  }
});

// ------------------------------------------------------------------- prices

test('price_kobo: zero and negative are refused by vehicle_category_price_kobo_check', async () => {
  for (const price of [0, -1]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await tx.$executeRawUnsafe(
        `UPDATE vehicle_category SET price_kobo = $1 WHERE id = $2::uuid`,
        price,
        fx.categoryId,
      );
    });
    assertRefusedBy(message, 'vehicle_category_price_kobo_check');
  }
});

test('price_kobo: 1 kobo is accepted (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE vehicle_category SET price_kobo = 1 WHERE id = $1::uuid`, fx.categoryId);
  });
  assert.equal(message, null);
});

test('price_kobo: the column is INTEGER, so a fraction cannot be stored', async () => {
  const rows = await prisma.$queryRaw<Array<{ data_type: string }>>`
    SELECT data_type FROM information_schema.columns
    WHERE table_name IN ('vehicle_category', 'payment', 'ticket')
      AND column_name IN ('price_kobo', 'amount_kobo')`;
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.data_type, 'integer');

  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE vehicle_category SET price_kobo = $1::text::integer WHERE id = $2::uuid`, '1.5', fx.categoryId);
  });
  assertRefusedBy(message, 'invalid input syntax for type integer');
});

test('amount_kobo on payment: zero is refused by payment_amount_kobo_check', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'PENDING');
    await tx.$executeRawUnsafe(`UPDATE payment SET amount_kobo = 0 WHERE id = $1::uuid`, payment.id);
  });
  assertRefusedBy(message, 'payment_amount_kobo_check');
});

// ----------------------------------------------------------------- payments

test('one PENDING payment per operator: a second is refused by payment_one_pending_per_operator', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await insertPayment(tx, fx, 'PENDING');
    await insertPayment(tx, fx, 'PENDING');
  });
  assertUniqueRefused(message, 'operator_id');
});

test('one PENDING payment per operator: other statuses, and other operators, are not blocked (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await insertPayment(tx, fx, 'PENDING');
    await insertPayment(tx, fx, 'FAILED');
    await insertPayment(tx, fx, 'SUCCESS');
    await insertPayment(tx, fx, 'SUCCESS');
    await insertPayment(tx, fx, 'PENDING', { operatorId: fx.exitOpId });
  });
  assert.equal(message, null);
});

test('payment reference is unique (payment_reference_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await insertPayment(tx, fx, 'FAILED', { reference: 'QRP-SAME' });
    await insertPayment(tx, fx, 'FAILED', { reference: 'QRP-SAME' });
  });
  assertUniqueRefused(message, 'reference');
});

test('idempotency key is unique across the table, whoever sent it (payment_idempotency_key_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await insertPayment(tx, fx, 'FAILED', { idempotencyKey: 'same-key' });
    await insertPayment(tx, fx, 'FAILED', { idempotencyKey: 'same-key', operatorId: fx.exitOpId });
  });
  assertUniqueRefused(message, 'idempotency_key');
});

test('paid_at is set if and only if SUCCESS (payment_paid_at_iff_success_check)', async () => {
  const noPaidAt = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'SUCCESS');
    await tx.$executeRawUnsafe(`UPDATE payment SET paid_at = NULL WHERE id = $1::uuid`, payment.id);
  });
  assertRefusedBy(noPaidAt, 'payment_paid_at_iff_success_check');

  const pendingWithPaidAt = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'PENDING');
    await tx.$executeRawUnsafe(`UPDATE payment SET paid_at = now() WHERE id = $1::uuid`, payment.id);
  });
  assertRefusedBy(pendingWithPaidAt, 'payment_paid_at_iff_success_check');
});

// ------------------------------------------------------------------ tickets

test('a ticket for a SUCCESS payment is accepted (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'SUCCESS');
    await rawInsertTicket(tx, fx, payment.id);
  });
  assert.equal(message, null);
});

test('no ticket for a payment that is not SUCCESS: raw insert refused by trigger ticket_requires_success_payment', async () => {
  for (const status of ['PENDING', 'FAILED', 'ABANDONED'] as const) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const payment = await insertPayment(tx, fx, status);
      await rawInsertTicket(tx, fx, payment.id);
    });
    assertRefusedBy(message, `is ${status}, not SUCCESS`);
  }
});

test('a payment with a ticket may still change status later (no freeze; Phase 2 refunds)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'SUCCESS');
    await rawInsertTicket(tx, fx, payment.id);
    await tx.$executeRawUnsafe(`UPDATE payment SET status = 'FAILED', paid_at = NULL WHERE id = $1::uuid`, payment.id);
  });
  assert.equal(message, null);
});

test('one ticket per payment (ticket_payment_id_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const payment = await insertPayment(tx, fx, 'SUCCESS');
    await rawInsertTicket(tx, fx, payment.id);
    await rawInsertTicket(tx, fx, payment.id);
  });
  assertUniqueRefused(message, 'payment_id');
});

test('ticket token is unique (ticket_token_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const token = fakeToken();
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { token });
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { token });
  });
  assertUniqueRefused(message, 'token');
});

test('ticket token must be 43 base64url characters (ticket_token_check)', async () => {
  for (const token of ['short', `${fakeToken()}x`, `${fakeToken().slice(0, 42)}=`]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { token });
    });
    assertRefusedBy(message, 'ticket_token_check');
  }
});

test('ticket number is unique per site (ticket_site_id_ticket_number_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const ticketNumber = fakeTicketNumber();
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { ticketNumber });
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { ticketNumber });
  });
  assertUniqueRefused(message, 'site_id, ticket_number');
});

test('ticket number format XXXX-XXXX without look-alikes (ticket_ticket_number_check)', async () => {
  for (const ticketNumber of ['ABCD-EFG0', 'ABCD-EFGO', 'ABCD-EFG1', 'ABCD-EFGI', 'ABCD-EFGL', 'abcd-efgh', 'ABCDEFGH']) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id, { ticketNumber });
    });
    assertRefusedBy(message, 'ticket_ticket_number_check');
  }
});

test('valid_until must equal paid_at + validity_hours (ticket_valid_until_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id);
    await tx.$executeRawUnsafe(`UPDATE ticket SET valid_until = valid_until + interval '1 hour' WHERE site_id = $1::uuid`, fx.siteId);
  });
  assertRefusedBy(message, 'ticket_valid_until_check');
});

test('USED needs used_at, used_gate_id and used_by_id together (ticket_used_fields_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id);
    await tx.$executeRawUnsafe(`UPDATE ticket SET status = 'USED', used_at = now() WHERE site_id = $1::uuid`, fx.siteId);
  });
  assertRefusedBy(message, 'ticket_used_fields_check');
});

test('a ticket cannot be marked used after valid_until (ticket_used_before_expiry_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id);
    await tx.$executeRawUnsafe(
      `UPDATE ticket SET status = 'USED', used_at = valid_until + interval '1 second',
         used_gate_id = $2::uuid, used_by_id = $3::uuid WHERE site_id = $1::uuid`,
      fx.siteId,
      fx.exitGateId,
      fx.exitOpId,
    );
  });
  assertRefusedBy(message, 'ticket_used_before_expiry_check');
});

// -------------------------------------------------------------- scan events

async function rawScan(
  tx: Parameters<Parameters<typeof attemptInRollback>[1]>[0],
  fx: Awaited<ReturnType<typeof buildFixture>>,
  kind: string,
  result: string,
  ticketId: string | null,
  deviceRef = 'install-1',
) {
  await tx.$executeRawUnsafe(
    `INSERT INTO scan_event (id, site_id, ticket_id, kind, result, gate_id, operator_id, device_ref)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::scan_kind, $4::scan_result, $5::uuid, $6::uuid, $7)`,
    fx.siteId,
    ticketId,
    kind,
    result,
    fx.exitGateId,
    fx.exitOpId,
    deviceRef,
  );
}

async function ticketId(tx: Parameters<Parameters<typeof attemptInRollback>[1]>[0], fx: Awaited<ReturnType<typeof buildFixture>>) {
  await rawInsertTicket(tx, fx, (await insertPayment(tx, fx, 'SUCCESS')).id);
  const row = await tx.ticket.findFirstOrThrow({ where: { siteId: fx.siteId }, select: { id: true } });
  return row.id;
}

test('scan results: ACTIVE only for CHECK, VALID only for EXIT (scan_event_result_by_kind_check)', async () => {
  for (const [kind, result] of [['EXIT', 'ACTIVE'], ['CHECK', 'VALID']]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await rawScan(tx, fx, kind, result, await ticketId(tx, fx));
    });
    assertRefusedBy(message, 'scan_event_result_by_kind_check');
  }

  const control = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const id = await ticketId(tx, fx);
    await rawScan(tx, fx, 'CHECK', 'ACTIVE', id);
    await rawScan(tx, fx, 'EXIT', 'VALID', id);
    await rawScan(tx, fx, 'EXIT', 'ALREADY_USED', id);
    await rawScan(tx, fx, 'CHECK', 'NOT_FOUND', null);
  });
  assert.equal(control, null);
});

test('a scan names its ticket exactly when it found one (scan_event_ticket_by_result_check)', async () => {
  const foundWithoutTicket = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawScan(tx, fx, 'EXIT', 'ALREADY_USED', null);
  });
  assertRefusedBy(foundWithoutTicket, 'scan_event_ticket_by_result_check');

  const notFoundWithTicket = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawScan(tx, fx, 'EXIT', 'NOT_FOUND', await ticketId(tx, fx));
  });
  assertRefusedBy(notFoundWithTicket, 'scan_event_ticket_by_result_check');
});

test('scan_event has no column that could hold the scanned token', async () => {
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'scan_event'`;
  const names = columns.map((c) => c.column_name).sort();
  assert.deepEqual(names, [
    'device_ref', 'gate_id', 'id', 'kind', 'occurred_at', 'operator_id', 'result', 'site_id', 'ticket_id',
  ]);
});

test('device_ref is 1-64 characters (scan_event_device_ref_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawScan(tx, fx, 'CHECK', 'NOT_FOUND', null, 'x'.repeat(65));
  });
  assertRefusedBy(message, 'scan_event_device_ref_check');
});

// ---------------------------------------------------------- users and site

test('an admin has no gate and an operator has one (app_user_gate_by_role_check)', async () => {
  const adminWithGate = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET gate_id = $1::uuid WHERE id = $2::uuid`, fx.entryGateId, fx.adminId);
  });
  assertRefusedBy(adminWithGate, 'app_user_gate_by_role_check');

  const operatorWithoutGate = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET gate_id = NULL WHERE id = $1::uuid`, fx.entryOpId);
  });
  assertRefusedBy(operatorWithoutGate, 'app_user_gate_by_role_check');
});

test('username: lower-case, 3-32 of a-z 0-9 . _ - (app_user_username_check)', async () => {
  for (const username of ['ab', 'Admin', 'a'.repeat(33), 'has space', 'mail@site']) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await tx.$executeRawUnsafe(`UPDATE app_user SET username = $1 WHERE id = $2::uuid`, username, fx.adminId);
    });
    assertRefusedBy(message, 'app_user_username_check');
  }
});

test('username is unique per site (app_user_site_id_username_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET username = 'admin' WHERE id = $1::uuid`, fx.entryOpId);
  });
  assertUniqueRefused(message, 'site_id, username');
});

test('validity_hours is 1-72 (site_setting_validity_hours_check)', async () => {
  for (const hours of [0, 73, -1]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await tx.$executeRawUnsafe(`UPDATE site_setting SET validity_hours = $1 WHERE site_id = $2::uuid`, hours, fx.siteId);
    });
    assertRefusedBy(message, 'site_setting_validity_hours_check');
  }
  const control = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE site_setting SET validity_hours = 72 WHERE site_id = $1::uuid`, fx.siteId);
    await tx.$executeRawUnsafe(`UPDATE site_setting SET validity_hours = 1 WHERE site_id = $1::uuid`, fx.siteId);
  });
  assert.equal(control, null);
});

test('payment_window_minutes is 1-30, default 5 (site_setting_payment_window_minutes_check)', async () => {
  for (const minutes of [0, 31, -5]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await tx.$executeRawUnsafe(`UPDATE site_setting SET payment_window_minutes = $1 WHERE site_id = $2::uuid`, minutes, fx.siteId);
    });
    assertRefusedBy(message, 'site_setting_payment_window_minutes_check');
  }
  const control = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const row = await tx.siteSetting.findUniqueOrThrow({ where: { siteId: fx.siteId } });
    assert.equal(row.paymentWindowMinutes, 5);
    await tx.$executeRawUnsafe(`UPDATE site_setting SET payment_window_minutes = 30 WHERE site_id = $1::uuid`, fx.siteId);
    await tx.$executeRawUnsafe(`UPDATE site_setting SET payment_window_minutes = 1 WHERE site_id = $1::uuid`, fx.siteId);
  });
  assert.equal(control, null);
});

// ---------------------------------------------------------------- audit_log

test('audit_log refuses UPDATE (audit_log is append-only)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const row = await tx.auditLog.create({
      data: { siteId: fx.siteId, actorId: fx.adminId, action: 'SETTINGS_CHANGED', targetType: 'site', targetId: fx.siteId },
    });
    await tx.$executeRawUnsafe(`UPDATE audit_log SET target_type = 'edited' WHERE id = $1::uuid`, row.id);
  });
  assertRefusedBy(message, 'audit_log is append-only: UPDATE refused');
});

test('audit_log refuses DELETE (audit_log is append-only)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const row = await tx.auditLog.create({
      data: { siteId: fx.siteId, actorId: fx.adminId, action: 'SETTINGS_CHANGED', targetType: 'site', targetId: fx.siteId },
    });
    await tx.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = $1::uuid`, row.id);
  });
  assertRefusedBy(message, 'audit_log is append-only: DELETE refused');
});

test('audit_log accepts INSERT (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.auditLog.create({
      data: { siteId: fx.siteId, actorId: fx.adminId, action: 'SETTINGS_CHANGED', targetType: 'site', targetId: fx.siteId },
    });
  });
  assert.equal(message, null);
});
