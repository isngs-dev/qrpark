import type { Prisma, PrismaClient, Ticket } from '@prisma/client';

/**
 * The two shapes a ticket leaves the backend in. docs/api.md, "The ticket
 * summary" and "POST /tickets".
 *
 * SUMMARY: no token. Check, lookup, recent and payment responses. Read with
 * one SQL statement so EXPIRED is decided on the database clock
 * (not validated and now() >= valid_until), like the exit test.
 *
 * PRINT VIEW: WITH THE TOKEN, to print. Only to the entry operator who
 * created the ticket and on a reprint. Never logged, never in audit detail.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type TicketState = 'UNPAID' | 'PAID' | 'VALIDATED' | 'EXPIRED';

export interface TicketSummary {
  id: string;
  ticketNumber: string;
  categoryName: string;
  feeKobo: number;
  issuedAt: Date;
  validUntil: Date;
  state: TicketState;
  paymentStatus: 'UNPAID' | 'PAID';
  validationStatus: 'NOT_VALIDATED' | 'VALIDATED';
  paidAt: Date | null;
  paymentMethod: 'CASH' | 'CARD' | null;
}

/** The columns of a summary, for `FROM ticket t LEFT JOIN payment pp ON pp.id = t.paid_payment_id`. */
export const SUMMARY_COLUMNS = `t.id::text AS id, t.ticket_number, t.category_name, t.fee_kobo, t.issued_at, t.valid_until,
  t.payment_status::text AS payment_status, t.validation_status::text AS validation_status, t.paid_at,
  pp.method::text AS payment_method,
  (t.validation_status = 'NOT_VALIDATED' AND now() >= t.valid_until) AS expired`;

export const SUMMARY_FROM = `ticket t LEFT JOIN payment pp ON pp.id = t.paid_payment_id`;

export interface SummaryRow {
  id: string;
  ticket_number: string;
  category_name: string;
  fee_kobo: number;
  issued_at: Date;
  valid_until: Date;
  payment_status: 'UNPAID' | 'PAID';
  validation_status: 'NOT_VALIDATED' | 'VALIDATED';
  paid_at: Date | null;
  payment_method: 'CASH' | 'CARD' | null;
  expired: boolean;
}

export function summaryOf(r: SummaryRow): TicketSummary {
  const state: TicketState =
    r.validation_status === 'VALIDATED' ? 'VALIDATED' : r.expired ? 'EXPIRED' : r.payment_status === 'PAID' ? 'PAID' : 'UNPAID';
  return {
    id: r.id,
    ticketNumber: r.ticket_number,
    categoryName: r.category_name,
    feeKobo: r.fee_kobo,
    issuedAt: r.issued_at,
    validUntil: r.valid_until,
    state,
    paymentStatus: r.payment_status,
    validationStatus: r.validation_status,
    paidAt: r.paid_at,
    paymentMethod: r.payment_method,
  };
}

/**
 * Summaries matching `where` (SQL over alias t; parameters $1...), then
 * `tail` (ORDER BY / LIMIT). Every value is a bound parameter.
 */
export async function loadSummaries(db: Db, where: string, params: unknown[], tail = ''): Promise<TicketSummary[]> {
  const rows = await db.$queryRawUnsafe<SummaryRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM ${SUMMARY_FROM} WHERE ${where} ${tail}`,
    ...params,
  );
  return rows.map(summaryOf);
}

export async function loadSummary(db: Db, ticketId: string): Promise<TicketSummary> {
  const [one] = await loadSummaries(db, 't.id = $1::uuid', [ticketId]);
  return one;
}

export interface ReceiptHeader {
  displayName: string;
  receiptOrgName: string | null;
  receiptContactLine: string | null;
}

export function printView(
  ticket: Ticket & { gate: { code: string; name: string }; operator: { name: string } },
  header: ReceiptHeader,
) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    token: ticket.token,
    categoryCode: ticket.categoryCode,
    categoryName: ticket.categoryName,
    feeKobo: ticket.feeKobo,
    issuedAt: ticket.issuedAt,
    validUntil: ticket.validUntil,
    paymentStatus: ticket.paymentStatus,
    validationStatus: ticket.validationStatus,
    gate: { code: ticket.gate.code, name: ticket.gate.name },
    operator: { name: ticket.operator.name },
    header,
  };
}
