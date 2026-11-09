import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { startCard } from '../test-support/payments';
import { fakeTicketNumber, fakeToken } from '../test-support/db';
import { as, newKey } from '../test-support/tickets';
import { CSV_MAX_DAYS } from './report-rules';

/**
 * Sprint 5a: the read-only report routes (ADMIN only). docs/api.md,
 * "Admin: reports". Every money rule is checked against the database itself.
 * Each test makes its own booth, operators and category, so its numbers are
 * exact whatever other tests in this file wrote.
 */

let t: TestApp;
let today: string;
let yesterday: string;
before(async () => {
  t = await bootTestApp();
  const [d] = await t.prisma.$queryRawUnsafe<Array<{ today: string; yesterday: string }>>(
    `SELECT to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS today,
            to_char(now() AT TIME ZONE 'Africa/Lagos' - interval '1 day', 'YYYY-MM-DD') AS yesterday`,
  );
  today = d.today;
  yesterday = d.yesterday;
});
after(() => t?.close());

const admin = async (path: string) => call(t, 'GET', path, { token: await t.accessToken(t.users.admin.id) });
const tag = () => randomBytes(3).toString('hex');

/** A location of its own for one test. */
async function gate(direction: 'ENTRY' | 'BOOTH' | 'EXIT') {
  const code = `${direction}_${tag()}`.toUpperCase();
  return t.prisma.gate.create({ data: { siteId: t.siteId, code, name: `${direction} ${code}`, direction } });
}

/** An operator of its own, at [gateId]. */
async function operator(role: 'ENTRY_OPERATOR' | 'PAYMENT_OPERATOR' | 'EXIT_OPERATOR', gateId: string, name?: string) {
  const username = `rep.${tag()}`;
  return t.prisma.appUser.create({
    data: {
      siteId: t.siteId, username, name: name ?? username, role, gateId,
      passwordHash: await argon2.hash(randomBytes(18).toString('base64url'), { type: argon2.argon2id }),
    },
  });
}

async function category(name = 'Car', priceKobo = 50_000) {
  return t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code: `C${tag()}`.toUpperCase(), name, priceKobo } });
}

/** A ticket by raw SQL (an earlier day allowed), issued by [operatorId] at [gateId]. */
async function ticket(o: { operatorId: string; gateId: string; categoryId: string; issuedAt?: string }) {
  const token = fakeToken();
  const ticketNumber = fakeTicketNumber();
  const rows = await t.prisma.$queryRawUnsafe<Array<{ id: string; fee_kobo: number }>>(
    `INSERT INTO ticket (id, site_id, idempotency_key, token, ticket_number, operator_id, gate_id, device_ref,
       category_id, category_code, category_name, fee_kobo, issued_at, updated_at)
     SELECT gen_random_uuid(), $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, 'rep-device', c.id, c.code, c.name, c.price_kobo,
            COALESCE($8::timestamptz, now()), now()
       FROM vehicle_category c WHERE c.id = $7::uuid
     RETURNING id::text, fee_kobo`,
    t.siteId, randomUUID(), token, ticketNumber, o.operatorId, o.gateId, o.categoryId, o.issuedAt ?? null,
  );
  return { id: rows[0].id, token, ticketNumber, feeKobo: rows[0].fee_kobo };
}

/** A payment by raw SQL at [boothId] by [operatorId]; SUCCESS pays the ticket. */
async function pay(tk: { id: string; feeKobo: number }, o: { method: 'CASH' | 'CARD'; boothId: string; operatorId: string; status?: 'SUCCESS' | 'DUPLICATE' }) {
  const status = o.status ?? 'SUCCESS';
  const reference = `QRP_${randomBytes(12).toString('hex')}`;
  const rows = await t.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO payment (id, site_id, ticket_id, method, reference, idempotency_key, operator_id, gate_id, device_ref,
       amount_kobo, status, paid_at, paystack_paid_at, paystack_event, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::payment_method, $4, $5, $6::uuid, $7::uuid, 'rep-booth',
       $8::int, $9::payment_status, CASE WHEN $9 = 'SUCCESS' THEN now() END,
       CASE WHEN $3 = 'CARD' THEN now() END,
       CASE WHEN $3 = 'CARD' THEN jsonb_build_object('reference', $4::text, 'authorization', jsonb_build_object('last4', '4081')) END, now())
     RETURNING id::text`,
    t.siteId, tk.id, o.method, reference, randomUUID(), o.operatorId, o.boothId, tk.feeKobo, status,
  );
  if (status === 'SUCCESS') {
    await t.prisma.$executeRawUnsafe(
      `UPDATE ticket SET payment_status = 'PAID', paid_payment_id = $2::uuid, paid_at = now() WHERE id = $1::uuid`,
      tk.id, rows[0].id,
    );
  }
  return { id: rows[0].id, reference };
}

async function validate(tk: { id: string }, exitGateId: string, exitOperatorId: string) {
  await t.prisma.$executeRawUnsafe(
    `UPDATE ticket SET validation_status = 'VALIDATED', validated_at = now(), validated_gate_id = $2::uuid, validated_by_id = $3::uuid
      WHERE id = $1::uuid`,
    tk.id, exitGateId, exitOperatorId,
  );
}

/** A world of its own: one entry gate, booth and exit, an operator at each, a category. */
async function world() {
  const entryGate = await gate('ENTRY');
  const booth = await gate('BOOTH');
  const exit = await gate('EXIT');
  return {
    entryGate, booth, exit,
    entryOp: await operator('ENTRY_OPERATOR', entryGate.id),
    boothOp: await operator('PAYMENT_OPERATOR', booth.id),
    exitOp: await operator('EXIT_OPERATOR', exit.id),
    cat: await category(),
  };
}

// ================================================================ finance

test('finance: revenue is SUCCESS only, cash and card apart and in total; DUPLICATE and cancelled card payments listed apart, never counted', async () => {
  const w = await world();
  const tk = (o = {}) => ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id, ...o });
  const t1 = await tk(); await pay(t1, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id });
  const t2 = await tk(); await pay(t2, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id });
  const t3 = await tk(); await pay(t3, { method: 'CARD', boothId: w.booth.id, operatorId: w.boothOp.id });
  // t1 also got a card payment Paystack confirmed after the cash: DUPLICATE, to refund.
  await pay(t1, { method: 'CARD', boothId: w.booth.id, operatorId: w.boothOp.id, status: 'DUPLICATE' });

  const res = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const booth = res.body.byBooth.find((b: { booth: { code: string } }) => b.booth.code === w.booth.code);
  assert.deepEqual(
    { cash: booth.cash, card: booth.card, total: booth.total },
    { cash: { count: 2, kobo: 100_000 }, card: { count: 1, kobo: 50_000 }, total: { count: 3, kobo: 150_000 } },
  );
  const op = res.body.byOperator.find((o: { operator: { id: string } }) => o.operator.id === w.boothOp.id);
  assert.deepEqual(op.total, { count: 3, kobo: 150_000 });
  const d = res.body.duplicates.find((x: { ticketNumber: string }) => x.ticketNumber === t1.ticketNumber);
  assert.ok(d, 'the DUPLICATE is listed');
  assert.equal(d.amountKobo, 50_000);
  assert.equal(d.ticketNumber, t1.ticketNumber);
  for (const k of ['cash', 'card', 'total']) {
    assert.equal(typeof res.body.total[k].kobo, 'number');
    assert.ok(Number.isInteger(res.body.total[k].kobo), 'integer kobo');
  }
});

test('finance: a cancelled card payment is listed apart (with forced), never counted; one Paystack later settled is revenue and not "cancelled"', async () => {
  const booth = t.users.booth.id;
  // A real cancel through the route (fake Paystack: still pending).
  const tkA = await t.prisma.ticket.findFirstOrThrow({ where: { id: (await ticket({ operatorId: t.users.entry.id, gateId: t.entryGateId, categoryId: (await category()).id })).id } });
  const start = await startCard(t, booth, { ticketId: tkA.id });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '2 minutes' WHERE id = $1::uuid`, start.body.id);
  const c = await as(t, booth, 'POST', `/payments/${start.body.id}/cancel`, {});
  assert.equal(c.body.outcome, 'CANCELLED');

  // A second one, cancelled, which Paystack later settled (the late check, T8): SUCCESS and the ticket PAID.
  const tkB = await t.prisma.ticket.findFirstOrThrow({ where: { id: (await ticket({ operatorId: t.users.entry.id, gateId: t.entryGateId, categoryId: (await category()).id })).id } });
  const startB = await startCard(t, booth, { ticketId: tkB.id });
  assert.equal(startB.status, 201, JSON.stringify(startB.body));
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '2 minutes' WHERE id = $1::uuid`, startB.body.id);
  assert.equal((await as(t, booth, 'POST', `/payments/${startB.body.id}/cancel`, {})).body.outcome, 'CANCELLED');
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET status = 'SUCCESS', paid_at = now(), paystack_paid_at = now(), paystack_event = '{"status":"success"}'::jsonb WHERE id = $1::uuid`,
    startB.body.id,
  );
  await t.prisma.$executeRawUnsafe(`UPDATE ticket SET payment_status = 'PAID', paid_payment_id = $1::uuid, paid_at = now() WHERE id = $2::uuid`, startB.body.id, tkB.id);

  const res = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  const cancelled = res.body.cancelled.find((x: { ticketNumber: string }) => x.ticketNumber === tkA.ticketNumber);
  assert.ok(cancelled, 'listed as cancelled');
  assert.equal(cancelled.forced, false);
  assert.equal(cancelled.amountKobo, tkA.feeKobo);
  assert.ok(!res.body.cancelled.some((x: { ticketNumber: string }) => x.ticketNumber === tkB.ticketNumber), 'a later-settled payment is not "cancelled"');
  const sql = await t.prisma.$queryRawUnsafe<Array<{ kobo: bigint }>>(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS kobo FROM payment WHERE site_id = $1::uuid AND status = 'SUCCESS'
        AND paid_at >= ($2::date)::timestamp AT TIME ZONE 'Africa/Lagos' AND paid_at < ($2::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'`,
    t.siteId, today,
  );
  assert.equal(res.body.total.total.kobo, Number(sql[0].kobo), 'the total is exactly the SUCCESS sum in the database');
});

test('finance: recorded cash per booth and per operator matches the database', async () => {
  const res = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  const rows = await t.prisma.$queryRawUnsafe<Array<{ gate_id: string; operator_id: string; method: string; n: bigint; kobo: bigint }>>(
    `SELECT gate_id::text, operator_id::text, method::text, COUNT(*) AS n, SUM(amount_kobo) AS kobo FROM payment
      WHERE site_id = $1::uuid AND status = 'SUCCESS'
        AND paid_at >= ($2::date)::timestamp AT TIME ZONE 'Africa/Lagos' AND paid_at < ($2::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'
      GROUP BY 1, 2, 3`,
    t.siteId, today,
  );
  const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
    rows.filter(pred).reduce((a, r) => ({ count: a.count + Number(r.n), kobo: a.kobo + Number(r.kobo) }), { count: 0, kobo: 0 });
  for (const b of res.body.byBooth) {
    assert.deepEqual(b.cash, sum((r) => r.gate_id === b.booth.id && r.method === 'CASH'), `cash at ${b.booth.code}`);
    assert.deepEqual(b.card, sum((r) => r.gate_id === b.booth.id && r.method === 'CARD'), `card at ${b.booth.code}`);
  }
  for (const o of res.body.byOperator) {
    assert.deepEqual(o.cash, sum((r) => r.operator_id === o.operator.id && r.method === 'CASH'), `cash by ${o.operator.id}`);
  }
  assert.ok(res.body.byBooth.length > 0);
});

test('finance and dashboard: a payment counts on the day it was PAID, not the day the ticket was issued', async () => {
  const w = await world();
  const old = await ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id, issuedAt: `${yesterday}T10:00:00+01:00` });
  await pay(old, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id });
  const todayRes = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  const b = todayRes.body.byBooth.find((x: { booth: { code: string } }) => x.booth.code === w.booth.code);
  assert.deepEqual(b.cash, { count: 1, kobo: old.feeKobo });
  const yRes = await admin(`/admin/reports/finance?from=${yesterday}&to=${yesterday}`);
  assert.equal(yRes.body.byBooth.find((x: { booth: { code: string } }) => x.booth.code === w.booth.code), undefined);
  // The ticket itself belongs to yesterday in Transactions.
  const tx = await admin(`/admin/reports/transactions?from=${yesterday}&to=${yesterday}&q=${old.ticketNumber.slice(-4)}`);
  assert.ok(tx.body.rows.some((r: { ticketNumber: string }) => r.ticketNumber === old.ticketNumber));
});

// ================================================================ dashboard

test('dashboard: today matches the database (tickets by issue day, revenue by paid day)', async () => {
  const res = await admin('/admin/reports/dashboard');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.day, today);
  const [c] = await t.prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(
    `SELECT COUNT(*) AS issued,
            COUNT(*) FILTER (WHERE payment_status = 'PAID') AS paid,
            COUNT(*) FILTER (WHERE validation_status = 'VALIDATED') AS validated,
            COUNT(*) FILTER (WHERE validation_status = 'NOT_VALIDATED' AND now() < valid_until) AS in_progress
       FROM ticket WHERE site_id = $1::uuid
        AND issued_at >= ($2::date)::timestamp AT TIME ZONE 'Africa/Lagos' AND issued_at < ($2::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'`,
    t.siteId, today,
  );
  assert.equal(res.body.tickets.issued, Number(c.issued));
  assert.equal(res.body.tickets.paid, Number(c.paid));
  assert.equal(res.body.tickets.validated, Number(c.validated));
  assert.equal(res.body.tickets.inProgress, Number(c.in_progress));
  const fin = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  assert.deepEqual(res.body.revenue, fin.body.total);

  // An earlier day: its unvalidated tickets have expired, so none is "in progress".
  const w = await world();
  await ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id, issuedAt: `${yesterday}T09:00:00+01:00` });
  const y = await admin(`/admin/reports/dashboard?day=${yesterday}`);
  const [yc] = await t.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM ticket WHERE site_id = $1::uuid AND validation_status = 'NOT_VALIDATED'
        AND issued_at >= ($2::date)::timestamp AT TIME ZONE 'Africa/Lagos' AND issued_at < ($2::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'`,
    t.siteId, yesterday,
  );
  assert.ok(Number(yc.n) > 0);
  assert.equal(y.body.tickets.inProgress, 0);
  assert.equal(y.body.tickets.neverValidated, Number(yc.n));
});

// ================================================================ incomplete

test('incomplete sessions: today in progress, earlier days never validated; unpaid tickets under "Unpaid (no booth)"; validated ones not listed', async () => {
  const w = await world();
  const tk = (o = {}) => ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id, ...o });
  const paidToday = await tk(); await pay(paidToday, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id });
  await tk(); // unpaid today
  const oldUnpaid = await tk({ issuedAt: `${yesterday}T09:00:00+01:00` });
  const done = await tk(); await pay(done, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id }); await validate(done, w.exit.id, w.exitOp.id);
  void oldUnpaid;

  const res = await admin(`/admin/reports/incomplete?from=${yesterday}&to=${today}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mine = res.body.groups.filter((g: { entryGate: { code: string } }) => g.entryGate.code === w.entryGate.code);
  const find = (day: string, booth: string | null) =>
    mine.find((g: { day: string; booth: { code: string } | null }) => g.day === day && (g.booth?.code ?? null) === booth);
  assert.deepEqual(
    { status: find(today, w.booth.code).status, count: find(today, w.booth.code).count },
    { status: 'IN_PROGRESS', count: 1 },
  );
  assert.equal(find(today, null).boothLabel, 'Unpaid (no booth)');
  assert.equal(find(today, null).count, 1);
  assert.deepEqual({ status: find(yesterday, null).status, count: find(yesterday, null).count }, { status: 'NEVER_VALIDATED', count: 1 });
  const total = mine.reduce((a: number, g: { count: number }) => a + g.count, 0);
  assert.equal(total, 3, 'the validated ticket is not incomplete');
  assert.equal(mine[0].operator.label.length > 0, true);
});

// ================================================================ transactions

test('transactions: search by the end of the number, filters, paging; the detail has payments, scans and reprints', async () => {
  const w = await world();
  const tk = await ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id });
  await pay(tk, { method: 'CARD', boothId: w.booth.id, operatorId: w.boothOp.id });
  await validate(tk, w.exit.id, w.exitOp.id);
  await t.prisma.scanEvent.create({ data: { siteId: t.siteId, ticketId: tk.id, kind: 'EXIT', result: 'VALID', gateId: w.exit.id, operatorId: w.exitOp.id, deviceRef: 'rep' } });

  const list = await admin(`/admin/reports/transactions?from=${today}&to=${today}&q=${tk.ticketNumber.slice(-5)}&state=VALIDATED&entryGate=${w.entryGate.code}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 1);
  const row = list.body.rows[0];
  assert.equal(row.ticketNumber, tk.ticketNumber);
  assert.equal(row.state, 'VALIDATED');
  assert.equal(row.paymentMethod, 'CARD');
  assert.equal(row.booth.code, w.booth.code);
  assert.equal(row.exitGate.code, w.exit.code);

  const byBooth = await admin(`/admin/reports/transactions?from=${today}&to=${today}&booth=${w.booth.code}&method=CARD`);
  assert.deepEqual(byBooth.body.rows.map((r: { ticketNumber: string }) => r.ticketNumber), [tk.ticketNumber]);
  const none = await admin(`/admin/reports/transactions?from=${today}&to=${today}&booth=${w.booth.code}&method=CASH`);
  assert.equal(none.body.total, 0);

  const detail = await admin(`/admin/reports/transactions/${tk.id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.ticket.ticketNumber, tk.ticketNumber);
  assert.equal(detail.body.payments.length, 1);
  assert.equal(detail.body.payments[0].countedAsRevenue, true);
  assert.equal(detail.body.scans.length, 1);
  assert.equal(detail.body.scans[0].result, 'VALID');
  assert.equal((await admin(`/admin/reports/transactions/${randomUUID()}`)).status, 404);
  assert.equal((await admin('/admin/reports/transactions/not-a-uuid')).status, 404);

  const page = await admin(`/admin/reports/transactions?from=${today}&to=${today}&pageSize=1&page=1`);
  assert.equal(page.body.rows.length, 1);
  assert.equal((await admin(`/admin/reports/transactions?pageSize=1000`)).status, 400);
});

// ================================================================ deleted operators

test('a deleted operator stays in every report and CSV as "name (deleted)"', async () => {
  const w = await world();
  const gone = await operator('ENTRY_OPERATOR', w.entryGate.id, 'Gone Person');
  const tk = await ticket({ operatorId: gone.id, gateId: w.entryGate.id, categoryId: w.cat.id });
  const del = await call(t, 'DELETE', `/admin/users/${gone.id}`, { token: await t.accessToken(t.users.admin.id) });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const boothGone = await operator('PAYMENT_OPERATOR', w.booth.id, 'Gone Cashier');
  await pay(tk, { method: 'CASH', boothId: w.booth.id, operatorId: boothGone.id });
  await call(t, 'DELETE', `/admin/users/${boothGone.id}`, { token: await t.accessToken(t.users.admin.id) });

  const tx = await admin(`/admin/reports/transactions?from=${today}&to=${today}&q=${tk.ticketNumber.slice(-4)}`);
  const row = tx.body.rows.find((r: { ticketNumber: string }) => r.ticketNumber === tk.ticketNumber);
  assert.equal(row.issuedBy.label, 'Gone Person (deleted)');
  assert.equal(row.paidBy.label, 'Gone Cashier (deleted)');
  const fin = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  assert.ok(fin.body.byOperator.some((o: { operator: { label: string } }) => o.operator.label === 'Gone Cashier (deleted)'));
  const csv = await admin(`/admin/reports/transactions?from=${today}&to=${today}&format=csv`);
  assert.ok(String(csv.body).includes('Gone Person (deleted)'));
  const fcsv = await admin(`/admin/reports/finance?from=${today}&to=${today}&format=csv`);
  assert.ok(String(fcsv.body).includes('Gone Cashier (deleted)'));
});

// ================================================================ CSV

/** A raw GET as the admin: status, headers, the exact bytes and the text. */
async function csv(path: string) {
  const res = await fetch(`${t.url}${path}`, { headers: { authorization: `Bearer ${await t.accessToken(t.users.admin.id)}` } });
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    disposition: res.headers.get('content-disposition') ?? '',
    bytes,
    text: bytes.toString('utf8'),
  };
}

test('CSV: text/csv attachment, UTF-8 with a BOM, CRLF, naira from kobo, Lagos times, formula cells neutralised, amounts untouched', async () => {
  const w = await world();
  const evilCat = await category('=HYPERLINK("http://evil.example","x")', 123_456);
  const evilOp = await operator('PAYMENT_OPERATOR', w.booth.id, '+SUM(1,2)');
  const tk = await ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: evilCat.id });
  await pay(tk, { method: 'CASH', boothId: w.booth.id, operatorId: evilOp.id });

  const res = await csv(`/admin/reports/transactions?from=${today}&to=${today}&format=csv`);
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.match(res.type, /^text\/csv; charset=utf-8/);
  assert.match(res.disposition, /attachment; filename="qrpark-transactions-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.deepEqual([...res.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte-order mark');
  assert.ok(res.text.includes('\r\n'));
  const lines = res.text.replace(/^﻿/, '').split('\r\n');
  const header = lines[0].split(',');
  assert.ok(header.includes('Amount (NGN)') && header.includes('Amount (kobo)'));
  const line = lines.find((l) => l.includes(tk.ticketNumber))!;
  assert.ok(line, 'the ticket is in the CSV');
  assert.ok(line.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), line);
  assert.ok(line.includes(`'+SUM(1`), line);
  assert.ok(line.includes(',1234.56,123456,'), `amounts untouched: ${line}`);
  assert.match(line, new RegExp(`${today} \\d{2}:\\d{2}`), 'Lagos time');
});

test(`CSV: needs from and to, at most ${CSV_MAX_DAYS} days; JSON pages are capped too`, async () => {
  for (const r of ['transactions', 'incomplete', 'finance']) {
    const noRange = await admin(`/admin/reports/${r}?format=csv`);
    assert.equal(noRange.status, 400, `${r}: ${JSON.stringify(noRange.body)}`);
    const long = await admin(`/admin/reports/${r}?format=csv&from=2026-01-01&to=2026-03-01`);
    assert.equal(long.status, 400, r);
    assert.match(JSON.stringify(long.body), /31 days/);
  }
  assert.equal((await admin('/admin/audit?format=csv')).status, 400);
  assert.equal((await admin('/admin/reports/finance?format=xlsx')).status, 400);
  assert.equal((await admin('/admin/reports/finance?from=2026-11-09&to=2026-11-01')).status, 400);
  assert.equal((await admin('/admin/reports/finance?from=nonsense')).status, 400);
});

// ================================================================ audit

test('audit view: filters, allow-listed detail fields only, and never a token, checkout URL or payment reference', async () => {
  // A cash confirmation (its audit detail holds the payment reference) and a reprint.
  const cat = await category();
  const tk = await ticket({ operatorId: t.users.entry.id, gateId: t.entryGateId, categoryId: cat.id });
  const cash = await as(t, t.users.booth.id, 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
  const rp = await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: tk.id });
  assert.equal(rp.status, 200, JSON.stringify(rp.body));

  const res = await admin(`/admin/audit?from=${today}&to=${today}&action=PAYMENT_CASH_CONFIRMED`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.rows.find((r: { detail: Array<{ field: string; value: unknown }> }) => r.detail.some((d) => d.value === tk.ticketNumber));
  assert.ok(row);
  assert.deepEqual(row.detail.map((d: { field: string }) => d.field), ['ticketNumber', 'amountKobo']);
  assert.equal(row.actor.label, t.users.booth.username);
  assert.ok(res.body.rows.every((r: { action: string }) => r.action === 'PAYMENT_CASH_CONFIRMED'));
  const byActor = await admin(`/admin/audit?from=${today}&to=${today}&actor=${t.users.entry.id}`);
  assert.ok(byActor.body.rows.every((r: { actor: { id: string } }) => r.actor.id === t.users.entry.id));
  assert.ok(byActor.body.rows.some((r: { action: string }) => r.action === 'TICKET_REPRINTED'));
  assert.equal((await admin('/admin/audit?action=NOT_AN_ACTION')).status, 400);

  const all = JSON.stringify((await admin(`/admin/audit?from=${today}&to=${today}&pageSize=200`)).body);
  const allCsv = (await csv(`/admin/audit?from=${today}&to=${today}&format=csv`)).text;
  const refs = (await t.prisma.payment.findMany({ where: { siteId: t.siteId }, select: { reference: true } })).map((p) => p.reference);
  const tokens = (await t.prisma.ticket.findMany({ where: { siteId: t.siteId }, select: { token: true } })).map((x) => x.token);
  for (const [name, text] of [['audit JSON', all], ['audit CSV', allCsv]] as const) {
    assert.ok(!refs.some((r) => text.includes(r)), `${name}: a payment reference`);
    assert.ok(!tokens.some((x) => text.includes(x)), `${name}: a token`);
    assert.ok(!/checkout\.paystack|authorization_?url|access_?code/i.test(text), `${name}: Paystack internals`);
  }
});

// ================================================================ price-change checklist (docs/04), through the API only

test('a price change shows at entry at once and never changes a ticket already issued (API only)', async () => {
  const cat = await category('Pickup', 60_000);
  const entry = t.users.entry.id;
  const before = await as(t, entry, 'POST', '/tickets', { categoryCode: cat.code, idempotencyKey: newKey() });
  assert.equal(before.status, 201, JSON.stringify(before.body));
  assert.equal(before.body.feeKobo, 60_000);

  const patch = await as(t, t.users.admin.id, 'PATCH', `/admin/categories/${cat.id}`, { priceKobo: 75_000 });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));

  const list = await as(t, entry, 'GET', '/categories');
  assert.equal(list.body.find((c: { code: string }) => c.code === cat.code).priceKobo, 75_000, 'entry sees the new price');
  const after = await as(t, entry, 'POST', '/tickets', { categoryCode: cat.code, idempotencyKey: newKey() });
  assert.equal(after.body.feeKobo, 75_000, 'a new ticket takes the new price');

  const old = await admin(`/admin/reports/transactions/${before.body.id}`);
  assert.equal(old.body.ticket.feeKobo, 60_000, 'the old ticket keeps its fee');
  const cash = await as(t, t.users.booth.id, 'POST', '/payments/cash', { ticketId: before.body.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
  assert.equal(cash.body.amountKobo, 60_000, 'and is paid at its own fee');

  const audit = await admin(`/admin/audit?from=${today}&to=${today}&action=CATEGORY_PRICE_CHANGED&pageSize=200`);
  const row = audit.body.rows.find((r: { detail: Array<{ field: string; value?: unknown }> }) => r.detail.some((d) => d.field === 'code' && d.value === cat.code));
  assert.deepEqual(row.detail, [{ field: 'code', value: cat.code }, { field: 'priceKobo', from: 60_000, to: 75_000 }]);
});

// ================================================================ no secrets anywhere

test('our payment reference is shown where an admin needs it; never a token, checkout URL, access code, authorization code or Paystack payload', async () => {
  // A card payment with a real (fake-Paystack) checkout URL and access code, then abandoned.
  const tk = await ticket({ operatorId: t.users.entry.id, gateId: t.entryGateId, categoryId: (await category()).id });
  const start = await startCard(t, t.users.booth.id, { ticketId: tk.id });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: start.body.id } });
  assert.ok(row.authorizationUrl && row.accessCode);
  await t.prisma.payment.update({ where: { id: row.id }, data: { status: 'ABANDONED' } });
  // A cash payment, then a DUPLICATE card payment on the same ticket carrying a Paystack payload with an authorization code.
  const w = await world();
  const tkD = await ticket({ operatorId: w.entryOp.id, gateId: w.entryGate.id, categoryId: w.cat.id });
  const cashPay = await pay(tkD, { method: 'CASH', boothId: w.booth.id, operatorId: w.boothOp.id });
  const dup = await pay(tkD, { method: 'CARD', boothId: w.booth.id, operatorId: w.boothOp.id, status: 'DUPLICATE' });
  const authCode = `AUTH_${randomBytes(6).toString('hex')}`;
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET paystack_event = jsonb_build_object('reference', reference, 'authorization', jsonb_build_object('authorization_code', $2::text, 'last4', '4081')) WHERE id = $1::uuid`,
    dup.id, authCode,
  );

  // Present where listed.
  const detail = await admin(`/admin/reports/transactions/${tk.id}`);
  assert.equal(detail.body.payments.find((p: { id: string }) => p.id === row.id).reference, row.reference, 'detail: the reference');
  const fin = await admin(`/admin/reports/finance?from=${today}&to=${today}`);
  assert.equal(fin.body.duplicates.find((d: { ticketNumber: string }) => d.ticketNumber === tkD.ticketNumber).reference, dup.reference, 'finance: the DUPLICATE reference');
  const finCsv = (await csv(`/admin/reports/finance?from=${today}&to=${today}&format=csv`)).text;
  assert.ok(finCsv.split('\r\n')[0].includes(',Reference,'), 'finance CSV: a Reference column');
  assert.ok(finCsv.includes(`,${cashPay.reference},`), 'finance CSV: the SUCCESS row has its reference');
  assert.ok(finCsv.includes(`,${dup.reference},`), 'finance CSV: the DUPLICATE row has its reference');

  // Absent everywhere.
  const tokens = (await t.prisma.ticket.findMany({ where: { siteId: t.siteId }, select: { token: true } })).map((x) => x.token);
  const paths = [
    '/admin/reports/dashboard',
    `/admin/reports/transactions?from=${yesterday}&to=${today}&pageSize=200`,
    `/admin/reports/transactions/${tk.id}`,
    `/admin/reports/transactions/${tkD.id}`,
    `/admin/reports/incomplete?from=${yesterday}&to=${today}`,
    `/admin/reports/finance?from=${yesterday}&to=${today}`,
    `/admin/audit?from=${yesterday}&to=${today}&pageSize=200`,
    `/admin/reports/transactions?from=${yesterday}&to=${today}&format=csv`,
    `/admin/reports/incomplete?from=${yesterday}&to=${today}&format=csv`,
    `/admin/reports/finance?from=${yesterday}&to=${today}&format=csv`,
    `/admin/audit?from=${yesterday}&to=${today}&format=csv`,
  ];
  for (const p of paths) {
    const r = await csv(p);
    assert.equal(r.status, 200, `${p}: ${r.text.slice(0, 200)}`);
    assert.ok(!tokens.some((x) => r.text.includes(x)), `${p}: a token`);
    assert.ok(!r.text.includes(row.authorizationUrl!), `${p}: the checkout URL`);
    assert.ok(!r.text.includes(row.accessCode!), `${p}: the access code`);
    assert.ok(!r.text.includes(authCode), `${p}: the authorization code`);
    assert.ok(!/authorization_?code|"authorization"|last4|paystack_?event|access_?code|authorization_?url/i.test(r.text), `${p}: Paystack payload or internals`);
  }
});
