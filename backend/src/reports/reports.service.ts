import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import {
  AUDIT_ACTIONS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  auditDetail,
  csvCell,
  csvDocument,
  lagosStamp,
  nairaPlain,
  parseRange,
  personLabel,
  rowCapProblem,
  type AuditField,
} from './report-rules';

/**
 * The admin reports (Sprint 5a, docs/api.md "Admin: reports"). READ-ONLY:
 * nothing here writes. Money is integer kobo from the database; the CSV turns
 * it into naira by string work (nairaPlain). Days are Lagos days on the
 * database clock. Never returned: a ticket token, a payment reference (T10),
 * a checkout URL, an access code, Paystack's payload. A deleted operator stays, as "name (deleted)".
 *
 * Attribution (review decisions, Sprint 5):
 *   tickets   by the Lagos day they were ISSUED
 *   revenue   by the Lagos day the backend recorded them PAID (payment.paid_at);
 *             SUCCESS only. DUPLICATE (refund in the Paystack dashboard) and
 *             cancelled card payments are listed apart and never counted.
 *   incomplete  not validated; IN_PROGRESS while valid (today), NEVER_VALIDATED after;
 *             grouped by issue day, entry gate, paying booth ("Unpaid (no booth)")
 *             and issuing operator.
 */

export interface Range {
  from: string;
  to: string;
}
export interface Paging {
  page: number;
  pageSize: number;
}
export interface Money {
  count: number;
  kobo: number;
}
interface GateRef {
  id: string;
  code: string;
  name: string;
}
interface Person {
  id: string;
  label: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUFFIX = /^[A-HJKMNP-Z2-9]{3,8}$/;
const STATES = ['UNPAID', 'PAID', 'VALIDATED', 'EXPIRED'] as const;

/** [from, to] Lagos days as instants, inclusive of [to]. $a and $b are the parameter numbers. */
const inRange = (column: string, a: number, b: number) =>
  `${column} >= ($${a}::date)::timestamp AT TIME ZONE 'Africa/Lagos' AND ${column} < ($${b}::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'`;

const lagosDay = (column: string) => `to_char(${column} AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD')`;

const gate = (id: string | null, code: string | null, name: string | null): GateRef | null =>
  id && code ? { id, code, name: name ?? code } : null;
const person = (id: string | null, name: string | null, deletedAt: Date | null): Person | null =>
  id ? { id, label: personLabel(name, deletedAt) } : null;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export interface TransactionFilters {
  q?: string;
  state?: string;
  category?: string;
  entryGate?: string;
  booth?: string;
  operator?: string;
  method?: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
  ) {}

  /** The database's Lagos date. */
  async today(): Promise<string> {
    const [r] = await this.prisma.$queryRawUnsafe<Array<{ d: string }>>(`SELECT ${lagosDay('now()')} AS d`);
    return r.d;
  }

  async range(q: { from?: string; to?: string }, csv: boolean): Promise<Range> {
    return parseRange(q, await this.today(), csv);
  }

  paging(q: { page?: string; pageSize?: string }): Paging {
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? PAGE_SIZE_DEFAULT : Number(q.pageSize);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a whole number from 1.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
      throw new BadRequestException(`pageSize must be 1-${PAGE_SIZE_MAX}.`);
    }
    return { page, pageSize };
  }

  // ============================================================ transactions

  private txWhere(siteId: string, r: Range, f: TransactionFilters) {
    const params: unknown[] = [siteId, r.from, r.to];
    const where = [`t.site_id = $1::uuid`, inRange('t.issued_at', 2, 3)];
    const add = (sql: (i: number) => string, value: unknown) => {
      params.push(value);
      where.push(sql(params.length));
    };
    if (f.q !== undefined) {
      const suffix = f.q.trim().toUpperCase().replace(/-/g, '');
      if (!SUFFIX.test(suffix)) throw new BadRequestException('q: 3-8 characters of a ticket number.');
      add((i) => `replace(t.ticket_number, '-', '') LIKE '%' || $${i}`, suffix);
    }
    if (f.state !== undefined) {
      if (!(STATES as readonly string[]).includes(f.state)) throw new BadRequestException(`state: one of ${STATES.join(', ')}.`);
      where.push(
        {
          VALIDATED: `t.validation_status = 'VALIDATED'`,
          EXPIRED: `t.validation_status = 'NOT_VALIDATED' AND now() >= t.valid_until`,
          PAID: `t.validation_status = 'NOT_VALIDATED' AND now() < t.valid_until AND t.payment_status = 'PAID'`,
          UNPAID: `t.validation_status = 'NOT_VALIDATED' AND now() < t.valid_until AND t.payment_status = 'UNPAID'`,
        }[f.state]!,
      );
    }
    if (f.category !== undefined) add((i) => `t.category_code = $${i}`, f.category);
    if (f.entryGate !== undefined) add((i) => `eg.code = $${i}`, f.entryGate);
    if (f.booth !== undefined) add((i) => `bg.code = $${i}`, f.booth);
    if (f.method !== undefined) {
      if (f.method !== 'CASH' && f.method !== 'CARD') throw new BadRequestException('method: CASH or CARD.');
      add((i) => `p.method = $${i}::payment_method`, f.method);
    }
    if (f.operator !== undefined) {
      if (!UUID.test(f.operator)) throw new BadRequestException('operator: a user id.');
      add((i) => `(t.operator_id = $${i}::uuid OR p.operator_id = $${i}::uuid OR t.validated_by_id = $${i}::uuid)`, f.operator);
    }
    return { params, where: where.join(' AND ') };
  }

  private static readonly TX_FROM = `
      FROM ticket t
      JOIN gate eg ON eg.id = t.gate_id
      JOIN app_user iu ON iu.id = t.operator_id
      LEFT JOIN payment p ON p.id = t.paid_payment_id
      LEFT JOIN gate bg ON bg.id = p.gate_id
      LEFT JOIN app_user pu ON pu.id = p.operator_id
      LEFT JOIN gate xg ON xg.id = t.validated_gate_id
      LEFT JOIN app_user vu ON vu.id = t.validated_by_id`;

  private static readonly TX_COLUMNS = `
      t.id::text AS id, t.ticket_number, t.category_code, t.category_name, t.fee_kobo, t.issued_at, t.valid_until,
      t.paid_at, t.validated_at,
      CASE WHEN t.validation_status = 'VALIDATED' THEN 'VALIDATED'
           WHEN now() >= t.valid_until THEN 'EXPIRED'
           ELSE t.payment_status::text END AS state,
      eg.id::text AS eg_id, eg.code AS eg_code, eg.name AS eg_name,
      iu.id::text AS iu_id, iu.name AS iu_name, iu.deleted_at AS iu_del,
      p.method::text AS method,
      bg.id::text AS bg_id, bg.code AS bg_code, bg.name AS bg_name,
      pu.id::text AS pu_id, pu.name AS pu_name, pu.deleted_at AS pu_del,
      xg.id::text AS xg_id, xg.code AS xg_code, xg.name AS xg_name,
      vu.id::text AS vu_id, vu.name AS vu_name, vu.deleted_at AS vu_del`;

  private txRow(r: Record<string, any>) {
    return {
      id: r.id as string,
      ticketNumber: r.ticket_number as string,
      categoryCode: r.category_code as string,
      categoryName: r.category_name as string,
      feeKobo: n(r.fee_kobo),
      issuedAt: r.issued_at as Date,
      validUntil: r.valid_until as Date,
      state: r.state as string,
      entryGate: gate(r.eg_id, r.eg_code, r.eg_name),
      issuedBy: person(r.iu_id, r.iu_name, r.iu_del),
      paymentMethod: (r.method as string | null) ?? null,
      paidAt: (r.paid_at as Date | null) ?? null,
      booth: gate(r.bg_id, r.bg_code, r.bg_name),
      paidBy: person(r.pu_id, r.pu_name, r.pu_del),
      validatedAt: (r.validated_at as Date | null) ?? null,
      exitGate: gate(r.xg_id, r.xg_code, r.xg_name),
      validatedBy: person(r.vu_id, r.vu_name, r.vu_del),
    };
  }

  async transactions(r: Range, f: TransactionFilters, paging: Paging) {
    const siteId = await this.site.getId();
    const { params, where } = this.txWhere(siteId, r, f);
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total ${ReportsService.TX_FROM} WHERE ${where}`,
      ...params,
    );
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT ${ReportsService.TX_COLUMNS} ${ReportsService.TX_FROM} WHERE ${where}
        ORDER BY t.issued_at DESC, t.id LIMIT ${paging.pageSize} OFFSET ${(paging.page - 1) * paging.pageSize}`,
      ...params,
    );
    return { ...r, page: paging.page, pageSize: paging.pageSize, total: n(total), rows: rows.map((x) => this.txRow(x)) };
  }

  async transactionsCsv(r: Range, f: TransactionFilters): Promise<string> {
    const siteId = await this.site.getId();
    const { params, where } = this.txWhere(siteId, r, f);
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total ${ReportsService.TX_FROM} WHERE ${where}`,
      ...params,
    );
    const cap = rowCapProblem(n(total));
    if (cap) throw new BadRequestException(cap);
    const rows = (
      await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
        `SELECT ${ReportsService.TX_COLUMNS} ${ReportsService.TX_FROM} WHERE ${where} ORDER BY t.issued_at, t.id`,
        ...params,
      )
    ).map((x) => this.txRow(x));
    return csvDocument(
      ['Ticket', 'Issued (Lagos)', 'Vehicle', 'Amount (NGN)', 'Amount (kobo)', 'Entry gate', 'Issued by', 'State',
        'Method', 'Paid (Lagos)', 'Booth', 'Paid by', 'Validated (Lagos)', 'Exit gate', 'Validated by'],
      rows.map((x) => [
        csvCell(x.ticketNumber, 'text'), csvCell(lagosStamp(x.issuedAt), 'text'), csvCell(x.categoryName, 'text'),
        csvCell(nairaPlain(x.feeKobo), 'amount'), csvCell(String(x.feeKobo), 'int'),
        csvCell(x.entryGate?.name, 'text'), csvCell(x.issuedBy?.label, 'text'), csvCell(x.state, 'text'),
        csvCell(x.paymentMethod, 'text'), csvCell(lagosStamp(x.paidAt), 'text'), csvCell(x.booth?.name, 'text'),
        csvCell(x.paidBy?.label, 'text'), csvCell(lagosStamp(x.validatedAt), 'text'), csvCell(x.exitGate?.name, 'text'),
        csvCell(x.validatedBy?.label, 'text'),
      ]),
    );
  }

  async transaction(id: string) {
    const siteId = await this.site.getId();
    if (!UUID.test(id)) throw new NotFoundException('No ticket found');
    const [row] = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT ${ReportsService.TX_COLUMNS} ${ReportsService.TX_FROM} WHERE t.site_id = $1::uuid AND t.id = $2::uuid`,
      siteId,
      id,
    );
    if (!row) throw new NotFoundException('No ticket found');
    const payments = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT p.id::text AS id, p.method::text AS method, p.status::text AS status, p.amount_kobo,
              p.created_at, p.paid_at, p.paystack_paid_at,
              g.id::text AS g_id, g.code AS g_code, g.name AS g_name, u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del,
              a.occurred_at AS cancelled_at, (a.detail->>'forced')::boolean AS forced
         FROM payment p JOIN gate g ON g.id = p.gate_id JOIN app_user u ON u.id = p.operator_id
         LEFT JOIN audit_log a ON a.action = 'PAYMENT_CANCELLED' AND a.target_type = 'payment' AND a.target_id = p.id::text
        WHERE p.site_id = $1::uuid AND p.ticket_id = $2::uuid ORDER BY p.created_at`,
      siteId,
      id,
    );
    const scans = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT s.occurred_at, s.kind::text AS kind, s.result::text AS result,
              g.id::text AS g_id, g.code AS g_code, g.name AS g_name, u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM scan_event s JOIN gate g ON g.id = s.gate_id JOIN app_user u ON u.id = s.operator_id
        WHERE s.site_id = $1::uuid AND s.ticket_id = $2::uuid ORDER BY s.occurred_at`,
      siteId,
      id,
    );
    const reprints = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT a.occurred_at, u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM audit_log a JOIN app_user u ON u.id = a.actor_id
        WHERE a.site_id = $1::uuid AND a.action = 'TICKET_REPRINTED' AND a.target_type = 'ticket' AND a.target_id = $2
        ORDER BY a.occurred_at`,
      siteId,
      id,
    );
    return {
      ticket: this.txRow(row),
      payments: payments.map((p) => ({
        id: p.id as string,
        method: p.method as string,
        status: p.status as string,
        amountKobo: n(p.amount_kobo),
        createdAt: p.created_at as Date,
        paidAt: (p.paid_at as Date | null) ?? null,
        paystackPaidAt: (p.paystack_paid_at as Date | null) ?? null,
        booth: gate(p.g_id, p.g_code, p.g_name),
        operator: person(p.u_id, p.u_name, p.u_del),
        cancelledAt: (p.cancelled_at as Date | null) ?? null,
        forced: p.cancelled_at ? Boolean(p.forced) : null,
        countedAsRevenue: p.status === 'SUCCESS',
      })),
      scans: scans.map((s) => ({
        occurredAt: s.occurred_at as Date,
        kind: s.kind as string,
        result: s.result as string,
        gate: gate(s.g_id, s.g_code, s.g_name),
        operator: person(s.u_id, s.u_name, s.u_del),
      })),
      reprints: reprints.map((x) => ({ occurredAt: x.occurred_at as Date, by: person(x.u_id, x.u_name, x.u_del) })),
    };
  }

  // ============================================================ incomplete

  async incomplete(r: Range) {
    const siteId = await this.site.getId();
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT ${lagosDay('t.issued_at')} AS day,
              eg.id::text AS eg_id, eg.code AS eg_code, eg.name AS eg_name,
              bg.id::text AS bg_id, bg.code AS bg_code, bg.name AS bg_name,
              iu.id::text AS iu_id, iu.name AS iu_name, iu.deleted_at AS iu_del,
              CASE WHEN now() < t.valid_until THEN 'IN_PROGRESS' ELSE 'NEVER_VALIDATED' END AS status,
              COUNT(*) AS n, COUNT(*) FILTER (WHERE t.payment_status = 'PAID') AS paid
         ${ReportsService.TX_FROM}
        WHERE t.site_id = $1::uuid AND ${inRange('t.issued_at', 2, 3)} AND t.validation_status = 'NOT_VALIDATED'
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
        ORDER BY 1 DESC, 3, 6 NULLS LAST, 9`,
      siteId,
      r.from,
      r.to,
    );
    const groups = rows.map((g) => {
      const booth = gate(g.bg_id, g.bg_code, g.bg_name);
      return {
        day: g.day as string,
        entryGate: gate(g.eg_id, g.eg_code, g.eg_name),
        booth,
        boothLabel: booth ? booth.name : 'Unpaid (no booth)',
        operator: person(g.iu_id, g.iu_name, g.iu_del),
        status: g.status as 'IN_PROGRESS' | 'NEVER_VALIDATED',
        count: n(g.n),
        paidCount: n(g.paid),
        unpaidCount: n(g.n) - n(g.paid),
      };
    });
    const sum = (pred: (g: (typeof groups)[number]) => boolean) => groups.filter(pred).reduce((a, g) => a + g.count, 0);
    return {
      ...r,
      groups,
      totals: { count: sum(() => true), inProgress: sum((g) => g.status === 'IN_PROGRESS'), neverValidated: sum((g) => g.status === 'NEVER_VALIDATED') },
    };
  }

  async incompleteCsv(r: Range): Promise<string> {
    const siteId = await this.site.getId();
    const where = `t.site_id = $1::uuid AND ${inRange('t.issued_at', 2, 3)} AND t.validation_status = 'NOT_VALIDATED'`;
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM ticket t WHERE ${where}`,
      siteId,
      r.from,
      r.to,
    );
    const cap = rowCapProblem(n(total));
    if (cap) throw new BadRequestException(cap);
    const rows = (
      await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
        `SELECT ${ReportsService.TX_COLUMNS} ${ReportsService.TX_FROM} WHERE ${where} ORDER BY t.issued_at, t.id`,
        siteId,
        r.from,
        r.to,
      )
    ).map((x) => this.txRow(x));
    return csvDocument(
      ['Ticket', 'Issued (Lagos)', 'Status', 'Vehicle', 'Amount (NGN)', 'Amount (kobo)', 'Entry gate', 'Issued by', 'Paid', 'Booth', 'Paid by'],
      rows.map((x) => [
        csvCell(x.ticketNumber, 'text'), csvCell(lagosStamp(x.issuedAt), 'text'),
        csvCell(x.state === 'EXPIRED' ? 'Never validated' : 'In progress', 'text'), csvCell(x.categoryName, 'text'),
        csvCell(nairaPlain(x.feeKobo), 'amount'), csvCell(String(x.feeKobo), 'int'), csvCell(x.entryGate?.name, 'text'),
        csvCell(x.issuedBy?.label, 'text'), csvCell(x.paymentMethod ? 'yes' : 'no', 'text'),
        csvCell(x.booth?.name ?? 'Unpaid (no booth)', 'text'), csvCell(x.paidBy?.label, 'text'),
      ]),
    );
  }

  // ============================================================ finance

  private static money(rows: Array<{ method: string; n: bigint; kobo: bigint }>) {
    const of = (m: string): Money => {
      const r = rows.filter((x) => x.method === m);
      return { count: r.reduce((a, x) => a + n(x.n), 0), kobo: r.reduce((a, x) => a + n(x.kobo), 0) };
    };
    const cash = of('CASH');
    const card = of('CARD');
    return { cash, card, total: { count: cash.count + card.count, kobo: cash.kobo + card.kobo } };
  }

  async finance(r: Range) {
    const siteId = await this.site.getId();
    const success = `p.site_id = $1::uuid AND p.status = 'SUCCESS' AND ${inRange('p.paid_at', 2, 3)}`;
    const byDayRows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT ${lagosDay('p.paid_at')} AS day, p.method::text AS method, COUNT(*) AS n, SUM(p.amount_kobo) AS kobo
         FROM payment p WHERE ${success} GROUP BY 1, 2 ORDER BY 1`,
      siteId, r.from, r.to,
    );
    const byBoothRows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT g.id::text AS g_id, g.code AS g_code, g.name AS g_name, p.method::text AS method, COUNT(*) AS n, SUM(p.amount_kobo) AS kobo
         FROM payment p JOIN gate g ON g.id = p.gate_id WHERE ${success} GROUP BY 1, 2, 3, 4 ORDER BY 2`,
      siteId, r.from, r.to,
    );
    const byOpRows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del, p.method::text AS method, COUNT(*) AS n, SUM(p.amount_kobo) AS kobo
         FROM payment p JOIN app_user u ON u.id = p.operator_id WHERE ${success} GROUP BY 1, 2, 3, 4 ORDER BY 2`,
      siteId, r.from, r.to,
    );
    const group = <K extends string>(rows: Array<any>, key: (x: any) => K) => {
      const map = new Map<K, Array<any>>();
      for (const x of rows) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
      return map;
    };
    const byDay = [...group(byDayRows, (x) => x.day as string)].map(([day, rows]) => ({ day, ...ReportsService.money(rows) }));
    const byBooth = [...group(byBoothRows, (x) => x.g_id as string)].map(([, rows]) => ({
      booth: gate(rows[0].g_id, rows[0].g_code, rows[0].g_name)!,
      ...ReportsService.money(rows),
    }));
    const byOperator = [...group(byOpRows, (x) => x.u_id as string)].map(([, rows]) => ({
      operator: person(rows[0].u_id, rows[0].u_name, rows[0].u_del)!,
      ...ReportsService.money(rows),
    }));
    const total = ReportsService.money(byDayRows);
    const { duplicates, cancelled } = await this.notRevenue(siteId, r);
    return { ...r, total, byDay, byBooth, byOperator, duplicates, cancelled };
  }

  /** DUPLICATE (to refund) and cancelled card payments in [r]: listed, never counted as revenue. */
  private async notRevenue(siteId: string, r: Range) {
    const duplicates = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT t.ticket_number, p.amount_kobo, p.paystack_paid_at, p.updated_at,
              g.id::text AS g_id, g.code AS g_code, g.name AS g_name, u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM payment p JOIN ticket t ON t.id = p.ticket_id JOIN gate g ON g.id = p.gate_id JOIN app_user u ON u.id = p.operator_id
        WHERE p.site_id = $1::uuid AND p.status = 'DUPLICATE' AND ${inRange('COALESCE(p.paystack_paid_at, p.updated_at)', 2, 3)}
        ORDER BY COALESCE(p.paystack_paid_at, p.updated_at)`,
      siteId, r.from, r.to,
    );
    const cancelled = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT t.ticket_number, p.amount_kobo, a.occurred_at, (a.detail->>'forced')::boolean AS forced,
              g.id::text AS g_id, g.code AS g_code, g.name AS g_name, u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM audit_log a JOIN payment p ON p.id::text = a.target_id AND a.target_type = 'payment'
         JOIN ticket t ON t.id = p.ticket_id JOIN gate g ON g.id = p.gate_id JOIN app_user u ON u.id = p.operator_id
        WHERE a.site_id = $1::uuid AND a.action = 'PAYMENT_CANCELLED' AND p.status = 'ABANDONED' AND ${inRange('a.occurred_at', 2, 3)}
        ORDER BY a.occurred_at`,
      siteId, r.from, r.to,
    );
    return {
      duplicates: duplicates.map((d) => ({
        ticketNumber: d.ticket_number as string,
        amountKobo: n(d.amount_kobo),
        paystackPaidAt: (d.paystack_paid_at as Date | null) ?? null,
        booth: gate(d.g_id, d.g_code, d.g_name),
        operator: person(d.u_id, d.u_name, d.u_del),
        note: 'Not revenue: refund it in the Paystack dashboard.',
      })),
      cancelled: cancelled.map((c) => ({
        ticketNumber: c.ticket_number as string,
        amountKobo: n(c.amount_kobo),
        cancelledAt: c.occurred_at as Date,
        forced: Boolean(c.forced),
        booth: gate(c.g_id, c.g_code, c.g_name),
        operator: person(c.u_id, c.u_name, c.u_del),
      })),
    };
  }

  async financeCsv(r: Range): Promise<string> {
    const siteId = await this.site.getId();
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM payment p WHERE p.site_id = $1::uuid AND p.status = 'SUCCESS' AND ${inRange('p.paid_at', 2, 3)}`,
      siteId, r.from, r.to,
    );
    const cap = rowCapProblem(n(total));
    if (cap) throw new BadRequestException(cap);
    const paid = await this.prisma.$queryRawUnsafe<Array<any>>(
      `SELECT p.paid_at, t.ticket_number, p.method::text AS method, p.amount_kobo, g.name AS g_name, u.name AS u_name, u.deleted_at AS u_del
         FROM payment p JOIN ticket t ON t.id = p.ticket_id JOIN gate g ON g.id = p.gate_id JOIN app_user u ON u.id = p.operator_id
        WHERE p.site_id = $1::uuid AND p.status = 'SUCCESS' AND ${inRange('p.paid_at', 2, 3)} ORDER BY p.paid_at`,
      siteId, r.from, r.to,
    );
    const { duplicates, cancelled } = await this.notRevenue(siteId, r);
    const line = (at: Date | null, ticket: string, method: string, status: string, counted: boolean, kobo: number, booth: string | undefined, op: string | undefined, note: string) => [
      csvCell(lagosStamp(at), 'text'), csvCell(ticket, 'text'), csvCell(method, 'text'), csvCell(status, 'text'),
      csvCell(counted ? 'yes' : 'no', 'text'), csvCell(nairaPlain(kobo), 'amount'), csvCell(String(kobo), 'int'),
      csvCell(booth, 'text'), csvCell(op, 'text'), csvCell(note, 'text'),
    ];
    return csvDocument(
      ['Time (Lagos)', 'Ticket', 'Method', 'Status', 'Counted as revenue', 'Amount (NGN)', 'Amount (kobo)', 'Booth', 'Operator', 'Note'],
      [
        ...paid.map((p) => line(p.paid_at, p.ticket_number, p.method, 'SUCCESS', true, n(p.amount_kobo), p.g_name, personLabel(p.u_name, p.u_del), '')),
        ...duplicates.map((d) => line(d.paystackPaidAt, d.ticketNumber, 'CARD', 'DUPLICATE', false, d.amountKobo, d.booth?.name, d.operator?.label, d.note)),
        ...cancelled.map((c) => line(c.cancelledAt, c.ticketNumber, 'CARD', 'CANCELLED', false, c.amountKobo, c.booth?.name, c.operator?.label, c.forced ? 'Cancelled (forced: Paystack could not be reached)' : 'Cancelled at the booth')),
      ],
    );
  }

  // ============================================================ dashboard

  async dashboard(day: string) {
    const siteId = await this.site.getId();
    const r = { from: day, to: day };
    const [c] = await this.prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(
      `SELECT COUNT(*) AS issued,
              COUNT(*) FILTER (WHERE payment_status = 'PAID') AS paid,
              COUNT(*) FILTER (WHERE payment_status = 'UNPAID') AS unpaid,
              COUNT(*) FILTER (WHERE validation_status = 'VALIDATED') AS validated,
              COUNT(*) FILTER (WHERE validation_status = 'NOT_VALIDATED' AND now() < valid_until) AS in_progress,
              COUNT(*) FILTER (WHERE validation_status = 'NOT_VALIDATED' AND now() >= valid_until) AS never_validated
         FROM ticket WHERE site_id = $1::uuid AND ${inRange('issued_at', 2, 3)}`,
      siteId, day, day,
    );
    const fin = await this.finance(r);
    return {
      day,
      tickets: {
        issued: n(c.issued), paid: n(c.paid), unpaid: n(c.unpaid), validated: n(c.validated),
        inProgress: n(c.in_progress), neverValidated: n(c.never_validated),
      },
      revenue: fin.total,
      notRevenue: {
        duplicate: { count: fin.duplicates.length, kobo: fin.duplicates.reduce((a, d) => a + d.amountKobo, 0) },
        cancelled: { count: fin.cancelled.length, kobo: fin.cancelled.reduce((a, d) => a + d.amountKobo, 0) },
      },
    };
  }

  // ============================================================ audit

  private auditWhere(siteId: string, r: Range, q: { action?: string; actor?: string }) {
    const params: unknown[] = [siteId, r.from, r.to];
    const where = [`a.site_id = $1::uuid`, inRange('a.occurred_at', 2, 3)];
    if (q.action !== undefined) {
      if (!AUDIT_ACTIONS.includes(q.action)) throw new BadRequestException('action: not an audit action.');
      params.push(q.action);
      where.push(`a.action = $${params.length}::audit_action`);
    }
    if (q.actor !== undefined) {
      if (!UUID.test(q.actor)) throw new BadRequestException('actor: a user id.');
      params.push(q.actor);
      where.push(`a.actor_id = $${params.length}::uuid`);
    }
    return { params, where: where.join(' AND ') };
  }

  private auditRow(a: Record<string, any>) {
    return {
      id: a.id as string,
      occurredAt: a.occurred_at as Date,
      action: a.action as string,
      actor: person(a.u_id, a.u_name, a.u_del),
      targetType: a.target_type as string,
      detail: auditDetail(a.action, a.detail),
    };
  }

  async audit(r: Range, q: { action?: string; actor?: string }, paging: Paging) {
    const siteId = await this.site.getId();
    const { params, where } = this.auditWhere(siteId, r, q);
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total FROM audit_log a WHERE ${where}`, ...params);
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT a.id::text AS id, a.occurred_at, a.action::text AS action, a.target_type, a.detail,
              u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM audit_log a JOIN app_user u ON u.id = a.actor_id WHERE ${where}
        ORDER BY a.occurred_at DESC, a.id LIMIT ${paging.pageSize} OFFSET ${(paging.page - 1) * paging.pageSize}`,
      ...params,
    );
    return { ...r, page: paging.page, pageSize: paging.pageSize, total: n(total), rows: rows.map((a) => this.auditRow(a)) };
  }

  async auditCsv(r: Range, q: { action?: string; actor?: string }): Promise<string> {
    const siteId = await this.site.getId();
    const { params, where } = this.auditWhere(siteId, r, q);
    const [{ total }] = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total FROM audit_log a WHERE ${where}`, ...params);
    const cap = rowCapProblem(n(total));
    if (cap) throw new BadRequestException(cap);
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT a.id::text AS id, a.occurred_at, a.action::text AS action, a.target_type, a.detail,
              u.id::text AS u_id, u.name AS u_name, u.deleted_at AS u_del
         FROM audit_log a JOIN app_user u ON u.id = a.actor_id WHERE ${where} ORDER BY a.occurred_at, a.id`,
      ...params,
    );
    const flat = (d: AuditField[]) =>
      d.map((f) => (f.value !== undefined ? `${f.field}: ${f.value}` : `${f.field}: ${f.from} -> ${f.to}`)).join('; ');
    return csvDocument(
      ['Time (Lagos)', 'Action', 'By', 'Details'],
      rows.map((a) => this.auditRow(a)).map((a) => [
        csvCell(lagosStamp(a.occurredAt), 'text'), csvCell(a.action, 'text'), csvCell(a.actor?.label, 'text'), csvCell(flat(a.detail), 'text'),
      ]),
    );
  }
}
