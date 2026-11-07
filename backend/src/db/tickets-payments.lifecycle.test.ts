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
  rawInsertPayment,
  rawInsertTicket,
  rawMarkPaid,
  rawPaidTicket,
  requireDatabase,
} from '../test-support/db';

/**
 * Migration 0003: the database rules of the new flow (entry ticket UNPAID,
 * booth payment cash or card, exit requires PAID). Every test writes past the
 * application with raw SQL and expects the named constraint, foreign key or
 * trigger to refuse it, in a transaction that is always rolled back. Each
 * rule has a positive control. See docs/schema.md.
 */

requireDatabase();
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

// ------------------------------------------------------- end of Lagos day

test('lagos_day_end: the start of the next Lagos day, at fixed instants', async () => {
  // Africa/Lagos is UTC+1 all year (no daylight saving).
  const cases: Array<[string, string]> = [
    ['2026-11-07T22:59:59Z', '2026-11-07T23:00:00.000Z'], // 23:59:59 Lagos -> midnight
    ['2026-11-07T23:00:00Z', '2026-11-08T23:00:00.000Z'], // 00:00 Lagos is a NEW day
    ['2026-11-07T23:00:01Z', '2026-11-08T23:00:00.000Z'],
    ['2026-11-07T00:00:00Z', '2026-11-07T23:00:00.000Z'], // 01:00 Lagos
    ['2026-12-31T22:59:59.999Z', '2026-12-31T23:00:00.000Z'], // the year ends at 23:00Z
  ];
  for (const [at, expected] of cases) {
    const rows = await prisma.$queryRawUnsafe<Array<{ end: Date }>>(`SELECT lagos_day_end($1::timestamptz) AS end`, at);
    assert.equal(rows[0].end.toISOString(), expected, `lagos_day_end(${at})`);
  }
});

test('valid_until is set by the database from issued_at, whatever the insert says', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const now = await rawInsertTicket(tx, fx, { validUntil: '2099-01-01T00:00:00Z' });
    const [{ expected }] = await tx.$queryRawUnsafe<Array<{ expected: Date }>>(
      `SELECT lagos_day_end(issued_at) AS expected FROM ticket WHERE id = $1::uuid`,
      now.id,
    );
    assert.equal(now.validUntil.getTime(), expected.getTime(), 'the supplied valid_until was kept');

    // An earlier-day ticket, as tests and the Sprint 6 run insert it.
    const old = await rawInsertTicket(tx, fx, { issuedAt: '2026-11-06T21:30:00Z' }); // 22:30 Lagos, 6 Nov
    assert.equal(old.validUntil.toISOString(), '2026-11-06T23:00:00.000Z');
  });
  assert.equal(message, null);
});

test('a new ticket is UNPAID and NOT_VALIDATED, and cannot be inserted otherwise (ticket_insert_guard)', async () => {
  const control = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const { id } = await rawInsertTicket(tx, fx);
    const row = await tx.ticket.findUniqueOrThrow({ where: { id } });
    assert.equal(row.paymentStatus, 'UNPAID');
    assert.equal(row.validationStatus, 'NOT_VALIDATED');
  });
  assert.equal(control, null);

  for (const o of [{ paymentStatus: 'PAID' }, { validationStatus: 'VALIDATED' }]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await rawInsertTicket(tx, fx, o);
    });
    assertRefusedBy(message, 'a new ticket is UNPAID and NOT_VALIDATED');
  }
});

// ------------------------------------------------------------ immutability

test('immutable after insert: token, number, fee, category, issue time, valid_until, idempotency key (ticket_guard)', async () => {
  const changes: Array<[string, string, unknown]> = [
    ['token', `token = $2`, fakeToken()],
    ['ticket_number', `ticket_number = $2`, fakeTicketNumber()],
    ['fee_kobo', `fee_kobo = $2::int`, 1],
    ['category_id', `category_id = (SELECT id FROM vehicle_category WHERE id <> category_id LIMIT 1)`, null],
    ['category_code', `category_code = $2`, 'BUS'],
    ['category_name', `category_name = $2`, 'Bus'],
    ['issued_at', `issued_at = issued_at - interval '1 day'`, null],
    ['valid_until', `valid_until = valid_until + interval '1 day'`, null],
    ['idempotency_key', `idempotency_key = $2`, 'another-key-0123456789'],
  ];
  for (const [column, set, value] of changes) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      await tx.vehicleCategory.create({ data: { siteId: fx.siteId, code: 'BUS', name: 'Bus', priceKobo: 1 } });
      const { id } = await rawInsertTicket(tx, fx);
      const params = value === null ? [id] : [id, value];
      await tx.$executeRawUnsafe(`UPDATE ticket SET ${set} WHERE id = $1::uuid`, ...params);
    });
    assertRefusedBy(message, `ticket ${column} cannot change`);
  }
});

// ------------------------------------------------------------ PAID

test('PAID through a SUCCESS payment of its own is accepted (control)', async () => {
  for (const method of ['CASH', 'CARD'] as const) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      const p = await rawInsertPayment(tx, fx, t.id, { method, status: 'SUCCESS' });
      await rawMarkPaid(tx, t.id, p.id);
    });
    assert.equal(message, null, method);
  }
});

test('PAID needs a payment, and a payment needs PAID: ticket_paid_iff_payment_check', async () => {
  const noPayment = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await tx.$executeRawUnsafe(`UPDATE ticket SET payment_status = 'PAID', paid_at = now() WHERE id = $1::uuid`, t.id);
  });
  assertRefusedBy(noPayment, 'ticket_paid_iff_payment_check');
});

test("PAID through ANOTHER ticket's SUCCESS payment is refused (ticket_paid_payment_id_id_fkey)", async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const mine = await rawInsertTicket(tx, fx);
    const other = await rawInsertTicket(tx, fx);
    const theirs = await rawInsertPayment(tx, fx, other.id, { method: 'CASH' });
    await rawMarkPaid(tx, mine.id, theirs.id);
  });
  assertRefusedBy(message, 'ticket_paid_payment_id_id_fkey');
});

test('PAID through its own payment that is not SUCCESS is refused (ticket_guard)', async () => {
  for (const status of ['PENDING', 'FAILED', 'ABANDONED', 'DUPLICATE']) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      const p = await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status, paystackEvent: status === 'DUPLICATE' });
      await rawMarkPaid(tx, t.id, p.id);
    });
    assertRefusedBy(message, 'is not a SUCCESS payment of this ticket');
  }
});

test('PAID cannot go back to UNPAID, and the paying payment cannot be swapped (ticket_guard)', async () => {
  const back = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx);
    await tx.$executeRawUnsafe(
      `UPDATE ticket SET payment_status = 'UNPAID', paid_payment_id = NULL, paid_at = NULL WHERE id = $1::uuid`,
      t.id,
    );
  });
  assertRefusedBy(back, 'ticket payment_status cannot go back from PAID');

  const swap = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx);
    await tx.$executeRawUnsafe(`UPDATE payment SET status = 'SUCCESS' WHERE id = $1::uuid`, t.paymentId);
    const second = await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: 'FAILED' });
    await tx.$executeRawUnsafe(`UPDATE ticket SET paid_payment_id = $2::uuid WHERE id = $1::uuid`, t.id, second.id);
  });
  assertRefusedBy(swap, 'ticket paid_payment_id cannot change');
});

// ------------------------------------------------------------ VALIDATED

const validate = (ticketId: string, fx: { exitGateId: string; exitOpId: string }) =>
  [`UPDATE ticket SET validation_status = 'VALIDATED', validated_at = now(), validated_gate_id = $2::uuid,
      validated_by_id = $3::uuid WHERE id = $1::uuid`, ticketId, fx.exitGateId, fx.exitOpId] as const;

test('VALIDATED on a PAID ticket is accepted (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx);
    await tx.$executeRawUnsafe(...validate(t.id, fx));
  });
  assert.equal(message, null);
});

test('VALIDATED requires PAID (ticket_validated_requires_paid_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await tx.$executeRawUnsafe(...validate(t.id, fx));
  });
  assertRefusedBy(message, 'ticket_validated_requires_paid_check');
});

test('VALIDATED cannot go back (ticket_guard), and its fields come together (ticket_validated_fields_check)', async () => {
  const back = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx);
    await tx.$executeRawUnsafe(...validate(t.id, fx));
    await tx.$executeRawUnsafe(
      `UPDATE ticket SET validation_status = 'NOT_VALIDATED', validated_at = NULL, validated_gate_id = NULL,
         validated_by_id = NULL WHERE id = $1::uuid`,
      t.id,
    );
  });
  assertRefusedBy(back, 'ticket validation_status cannot go back from VALIDATED');

  const partial = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx);
    await tx.$executeRawUnsafe(`UPDATE ticket SET validation_status = 'VALIDATED', validated_at = now() WHERE id = $1::uuid`, t.id);
  });
  assertRefusedBy(partial, 'ticket_validated_fields_check');
});

test('a ticket cannot be validated at or after valid_until (ticket_validated_before_expiry_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawPaidTicket(tx, fx, { issuedAt: '2026-11-01T10:00:00Z' });
    await tx.$executeRawUnsafe(...validate(t.id, fx));
  });
  assertRefusedBy(message, 'ticket_validated_before_expiry_check');
});

// ------------------------------------------------------------ payments

test("a payment's amount must equal its ticket's fee snapshot (payment_ticket_id_amount_kobo_fkey)", async () => {
  for (const amountKobo of [49_999, 50_001, 1]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx, { feeKobo: 50_000 });
      await rawInsertPayment(tx, fx, t.id, { amountKobo });
    });
    assertRefusedBy(message, 'payment_ticket_id_amount_kobo_fkey');
  }
});

test('at most one SUCCESS payment per ticket (payment_one_success_per_ticket)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await rawInsertPayment(tx, fx, t.id, { method: 'CASH' });
    await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: 'SUCCESS', operatorId: fx.entryOpId });
  });
  assertUniqueRefused(message, 'ticket_id');
});

test('at most one PENDING payment per ticket (payment_one_pending_per_ticket)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: 'PENDING' });
    // A different operator, so only the per-ticket index can fire.
    await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: 'PENDING', operatorId: fx.entryOpId });
  });
  assertUniqueRefused(message, 'ticket_id');
});

test('one PENDING payment per operator, across tickets (payment_one_pending_per_operator)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const a = await rawInsertTicket(tx, fx);
    const b = await rawInsertTicket(tx, fx);
    await rawInsertPayment(tx, fx, a.id, { method: 'CARD', status: 'PENDING' });
    await rawInsertPayment(tx, fx, b.id, { method: 'CARD', status: 'PENDING' });
  });
  assertUniqueRefused(message, 'operator_id');
});

test('several attempts per ticket are fine: FAILED, ABANDONED, then one SUCCESS (control)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await rawInsertPayment(tx, fx, t.id, { status: 'FAILED' });
    await rawInsertPayment(tx, fx, t.id, { status: 'ABANDONED' });
    await rawInsertPayment(tx, fx, t.id, { status: 'DUPLICATE', paystackEvent: true });
    await rawInsertPayment(tx, fx, t.id, { method: 'CASH' });
  });
  assert.equal(message, null);
});

test('idempotency keys are unique on payments and on tickets', async () => {
  const payments = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await rawInsertPayment(tx, fx, t.id, { status: 'FAILED', idempotencyKey: 'same-key-0123456789' });
    await rawInsertPayment(tx, fx, t.id, { status: 'FAILED', idempotencyKey: 'same-key-0123456789' });
  });
  assertUniqueRefused(payments, 'idempotency_key');

  const tickets = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await rawInsertTicket(tx, fx, { idempotencyKey: 'same-key-0123456789' });
    await rawInsertTicket(tx, fx, { idempotencyKey: 'same-key-0123456789' });
  });
  assertUniqueRefused(tickets, 'idempotency_key');
});

test('cash is recorded SUCCESS, with no Paystack fields (payment_cash_check)', async () => {
  for (const o of [{ status: 'PENDING' }, { status: 'FAILED' }, { status: 'SUCCESS', paystackEvent: true }]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      await rawInsertPayment(tx, fx, t.id, { method: 'CASH', ...o });
    });
    assertRefusedBy(message, 'payment_cash_check');
  }
});

test('DUPLICATE is a card status only, and keeps Paystack payload (payment_duplicate_check)', async () => {
  for (const o of [{ method: 'CASH' as const, status: 'DUPLICATE' }, { method: 'CARD' as const, status: 'DUPLICATE', paystackEvent: false }]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      await rawInsertPayment(tx, fx, t.id, o);
    });
    assert.ok(message !== null, `accepted ${JSON.stringify(o)}`);
    assert.ok(/payment_duplicate_check|payment_cash_check/.test(message), message);
  }
});

test('the freeze: SUCCESS and DUPLICATE never change status (payment_guard)', async () => {
  for (const [from, to] of [['SUCCESS', 'FAILED'], ['SUCCESS', 'ABANDONED'], ['SUCCESS', 'DUPLICATE'], ['DUPLICATE', 'SUCCESS'], ['DUPLICATE', 'FAILED']]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      const p = await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: from, paystackEvent: true });
      await tx.$executeRawUnsafe(
        `UPDATE payment SET status = $2::payment_status, paid_at = CASE WHEN $2 = 'SUCCESS' THEN now() END WHERE id = $1::uuid`,
        p.id,
        to,
      );
    });
    assertRefusedBy(message, `its status cannot change`);
  }
});

test('late answers are allowed: ABANDONED or FAILED -> SUCCESS, and -> DUPLICATE (control)', async () => {
  for (const [from, to] of [['ABANDONED', 'SUCCESS'], ['FAILED', 'SUCCESS'], ['ABANDONED', 'DUPLICATE'], ['PENDING', 'DUPLICATE']]) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      const p = await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: from, paystackEvent: true });
      await tx.$executeRawUnsafe(
        `UPDATE payment SET status = $2::payment_status, paid_at = CASE WHEN $2 = 'SUCCESS' THEN now() END WHERE id = $1::uuid`,
        p.id,
        to,
      );
    });
    assert.equal(message, null, `${from} -> ${to}`);
  }
});

test('immutable payment facts: ticket, amount, method, reference, key, operator, booth, device (payment_guard)', async () => {
  const sets: Array<[string, string]> = [
    ['ticket_id', `ticket_id = (SELECT id FROM ticket WHERE id <> ticket_id AND site_id = payment.site_id LIMIT 1)`],
    ['method', `method = 'CASH'`],
    ['reference', `reference = 'QRP_changed'`],
    ['idempotency_key', `idempotency_key = 'changed-key-0123456789'`],
    ['operator_id', `operator_id = (SELECT id FROM app_user WHERE id <> operator_id AND site_id = payment.site_id LIMIT 1)`],
    ['gate_id', `gate_id = (SELECT id FROM gate WHERE id <> gate_id AND site_id = payment.site_id LIMIT 1)`],
    ['device_ref', `device_ref = 'other-device'`],
  ];
  for (const [column, set] of sets) {
    const message = await attemptInRollback(prisma, async (tx) => {
      const fx = await buildFixture(tx);
      const t = await rawInsertTicket(tx, fx);
      await rawInsertTicket(tx, fx);
      const p = await rawInsertPayment(tx, fx, t.id, { method: 'CARD', status: 'PENDING' });
      await tx.$executeRawUnsafe(`UPDATE payment SET ${set} WHERE id = $1::uuid`, p.id);
    });
    assertRefusedBy(message, `payment ${column} cannot change`);
  }
});

// ------------------------------------------------------------ scans

test('scan results: PAYMENT_REQUIRED for either kind; ACTIVE check only; VALID exit only', async () => {
  const insert = (kind: string, result: string) => async (tx: Parameters<Parameters<typeof attemptInRollback>[1]>[0]) => {
    const fx = await buildFixture(tx);
    const t = await rawInsertTicket(tx, fx);
    await tx.$executeRawUnsafe(
      `INSERT INTO scan_event (id, site_id, ticket_id, kind, result, gate_id, operator_id, device_ref)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::scan_kind, $4::scan_result, $5::uuid, $6::uuid, 'd')`,
      fx.siteId, t.id, kind, result, fx.exitGateId, fx.exitOpId,
    );
  };
  for (const kind of ['CHECK', 'EXIT']) {
    assert.equal(await attemptInRollback(prisma, insert(kind, 'PAYMENT_REQUIRED')), null, `${kind} PAYMENT_REQUIRED`);
  }
  assertRefusedBy(await attemptInRollback(prisma, insert('EXIT', 'ACTIVE')), 'scan_event_result_by_kind_check');
  assertRefusedBy(await attemptInRollback(prisma, insert('CHECK', 'VALID')), 'scan_event_result_by_kind_check');
});

// ------------------------------------------------------------ accounts

test('soft delete: a deleted account is inactive, and its username can be reused', async () => {
  const active = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET deleted_at = now() WHERE id = $1::uuid`, fx.entryOpId);
  });
  assertRefusedBy(active, 'app_user_deleted_is_inactive_check');

  const reuse = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET is_active = false, deleted_at = now() WHERE id = $1::uuid`, fx.entryOpId);
    await tx.appUser.create({
      data: { siteId: fx.siteId, username: 'entry.op', name: 'Again', passwordHash: 'x', role: 'ENTRY_OPERATOR', gateId: fx.entryGateId },
    });
  });
  assert.equal(reuse, null, 'a deleted username could not be reused');
});

test('two live accounts cannot share a username (app_user_live_username_key)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET username = 'admin' WHERE id = $1::uuid`, fx.entryOpId);
  });
  assertUniqueRefused(message, 'site_id, username');
});

test('a payment operator has a gate like every operator (app_user_gate_by_role_check)', async () => {
  const message = await attemptInRollback(prisma, async (tx) => {
    const fx = await buildFixture(tx);
    await tx.$executeRawUnsafe(`UPDATE app_user SET gate_id = NULL WHERE id = $1::uuid`, fx.boothOpId);
  });
  assertRefusedBy(message, 'app_user_gate_by_role_check');
});

// ------------------------------------------------------------ shape

test('the old shape is gone: no ticket.payment_id, customer_name, validity_hours; no validity_hours setting', async () => {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'ticket' AND column_name IN ('payment_id', 'customer_name', 'validity_hours', 'payment_reference', 'status'))
        OR (table_name = 'payment' AND column_name IN ('customer_name', 'category_id', 'category_code', 'category_name'))
        OR (table_name = 'site_setting' AND column_name = 'validity_hours'))`;
  assert.deepEqual(rows, []);
  const trig = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'ticket_requires_success_payment'`;
  assert.equal(Number(trig[0].n), 0);
});
