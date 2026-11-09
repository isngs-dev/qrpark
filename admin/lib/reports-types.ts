/**
 * The report pages' shapes and rules (pure; Sprint 5c). Written new.
 *
 * Shapes follow docs/api.md "Admin: reports" exactly. There is deliberately no
 * field for anything secret, so nothing secret can be shown by mistake; our own
 * payment reference IS a field (T10).
 *
 * Days: the portal never decides a day. With no day chosen it sends none and
 * the backend answers with its Lagos today; every range shown is the one the
 * backend returned, and days are formatted from "YYYY-MM-DD" by text.
 */

export interface Range {
  from: string;
  to: string;
}
export interface Person {
  id: string;
  label: string;
}
export interface Place {
  id: string;
  code: string;
  name: string;
}
export interface Money {
  count: number;
  kobo: number;
}
export interface Split {
  cash: Money;
  card: Money;
  total: Money;
}

export type TicketState = 'UNPAID' | 'PAID' | 'VALIDATED' | 'EXPIRED';

export interface TxRow {
  id: string;
  ticketNumber: string;
  categoryCode: string;
  categoryName: string;
  feeKobo: number;
  issuedAt: string;
  validUntil: string;
  state: TicketState;
  entryGate: Place | null;
  issuedBy: Person | null;
  paymentMethod: 'CASH' | 'CARD' | null;
  paidAt: string | null;
  booth: Place | null;
  paidBy: Person | null;
  validatedAt: string | null;
  exitGate: Place | null;
  validatedBy: Person | null;
}

export interface Paged<T> extends Range {
  page: number;
  pageSize: number;
  total: number;
  rows: T[];
}

export interface TxPayment {
  id: string;
  reference: string;
  method: 'CASH' | 'CARD';
  status: string;
  amountKobo: number;
  createdAt: string;
  paidAt: string | null;
  paystackPaidAt: string | null;
  booth: Place | null;
  operator: Person | null;
  cancelledAt: string | null;
  forced: boolean | null;
  countedAsRevenue: boolean;
}

export interface TxDetail {
  ticket: TxRow;
  payments: TxPayment[];
  scans: Array<{ occurredAt: string; kind: string; result: string; gate: Place | null; operator: Person | null }>;
  reprints: Array<{ occurredAt: string; by: Person | null }>;
}

export interface IncompleteReport extends Range {
  groups: Array<{
    day: string;
    entryGate: Place | null;
    booth: Place | null;
    boothLabel: string;
    operator: Person | null;
    status: 'IN_PROGRESS' | 'NEVER_VALIDATED';
    count: number;
    paidCount: number;
    unpaidCount: number;
  }>;
  totals: { count: number; inProgress: number; neverValidated: number };
}

export interface FinanceReport extends Range {
  total: Split;
  byDay: Array<{ day: string } & Split>;
  byBooth: Array<{ booth: Place } & Split>;
  byOperator: Array<{ operator: Person } & Split>;
  duplicates: Array<{ reference: string; ticketNumber: string; amountKobo: number; paystackPaidAt: string | null; booth: Place | null; operator: Person | null; note: string }>;
  cancelled: Array<{ reference: string; ticketNumber: string; amountKobo: number; cancelledAt: string; forced: boolean; booth: Place | null; operator: Person | null }>;
}

export interface Dashboard {
  day: string;
  tickets: { issued: number; paid: number; unpaid: number; validated: number; inProgress: number; neverValidated: number };
  revenue: Split;
  notRevenue: { duplicate: Money; cancelled: Money };
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  actor: Person | null;
  targetType: string;
  detail: Array<{ field: string; value?: string | number | boolean | null; from?: string | number | boolean | null; to?: string | number | boolean | null }>;
}

// ---------------------------------------------------------------- the reports and their parameters

type ReportName = 'dashboard' | 'transactions' | 'incomplete' | 'finance' | 'audit';

/** Each report's backend route and the only parameters the portal will pass to it. */
export const REPORTS: Record<ReportName, { path: string; params: string[]; paged: boolean; csv: boolean }> = {
  dashboard: { path: '/admin/reports/dashboard', params: ['day'], paged: false, csv: false },
  transactions: { path: '/admin/reports/transactions', params: ['from', 'to', 'q', 'state', 'category', 'entryGate', 'booth', 'method', 'operator'], paged: true, csv: true },
  incomplete: { path: '/admin/reports/incomplete', params: ['from', 'to'], paged: false, csv: true },
  finance: { path: '/admin/reports/finance', params: ['from', 'to'], paged: false, csv: true },
  audit: { path: '/admin/audit', params: ['from', 'to', 'action', 'actor'], paged: true, csv: true },
};

export const PAGE_SIZE = 50;

type Input = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? '';

/** The query for a report: only its own parameters, trimmed, empty ones dropped (so no day means the backend's today). */
export function reportQuery(report: ReportName, input: Input, paging?: { page: number }): string {
  const q = new URLSearchParams();
  for (const name of REPORTS[report].params) {
    const v = first(input[name]);
    if (v) q.set(name, v);
  }
  if (paging && REPORTS[report].paged) {
    q.set('page', String(paging.page));
    q.set('pageSize', String(PAGE_SIZE));
  }
  return q.toString();
}

/** The portal's CSV link: the range the backend answered with, plus the report's filters on screen. */
export function csvHref(report: Exclude<ReportName, 'dashboard'>, range: Range, input: Input): string {
  const q = new URLSearchParams({ from: range.from, to: range.to });
  for (const name of REPORTS[report].params) {
    if (name === 'from' || name === 'to') continue;
    const v = first(input[name]);
    if (v) q.set(name, v);
  }
  return `/csv/${report}?${q.toString()}`;
}

/**
 * What the CSV route may ask the backend for: one of the four reports, only
 * that report's parameters, each at most once; `format=csv` is added here.
 * Anything else is refused before the backend is called.
 */
export function csvBackendPath(report: string, search: URLSearchParams): { path: string } | { error: string } {
  const spec = Object.prototype.hasOwnProperty.call(REPORTS, report) ? REPORTS[report as ReportName] : undefined;
  if (!spec || !spec.csv) return { error: 'There is no such report to download.' };
  const q = new URLSearchParams();
  for (const name of new Set(search.keys())) {
    if (!spec.params.includes(name)) return { error: `"${name}" is not a filter of this report.` };
    const values = search.getAll(name);
    if (values.length !== 1) return { error: `"${name}" given more than once.` };
    if (values[0].length > 40) return { error: `"${name}" is too long.` };
  }
  for (const name of spec.params) {
    const v = search.get(name);
    if (v !== null && v !== '') q.set(name, v);
  }
  q.set('format', 'csv');
  return { path: `${spec.path}?${q.toString()}` };
}

// ---------------------------------------------------------------- days and pages

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-09" as "9 Nov 2026", by text: the day is the backend's Lagos day. */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function rangeLabel(range: Range): string {
  return range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} to ${dayLabel(range.to)}`;
}

/** Previous / next links with the filters kept, and "Page N of M". */
export function pageLinks(path: string, input: Input, page: { page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(input)) {
      const value = first(v);
      if (k !== 'page' && value) q.set(k, value);
    }
    q.set('page', String(n));
    return `${path}?${q.toString()}`;
  };
  return {
    label: `Page ${page.page} of ${pages} (${page.total} rows)`,
    prev: page.page > 1 ? href(page.page - 1) : null,
    next: page.page < pages ? href(page.page + 1) : null,
  };
}

// ---------------------------------------------------------------- labels

export const STATE_LABELS: Record<TicketState, string> = {
  UNPAID: 'Unpaid',
  PAID: 'Paid, not yet out',
  VALIDATED: 'Paid and left (validated)',
  EXPIRED: 'Expired: issued on an earlier day, never validated',
};

export const INCOMPLETE_LABELS = {
  IN_PROGRESS: 'In progress (today)',
  NEVER_VALIDATED: 'Never validated (earlier day)',
} as const;

export const METHOD_LABELS: Record<string, string> = { CASH: 'Cash', CARD: 'Card' };

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CATEGORY_CREATED: 'Vehicle type added',
  CATEGORY_UPDATED: 'Vehicle type changed',
  CATEGORY_PRICE_CHANGED: 'Price changed',
  SETTINGS_CHANGED: 'Settings changed',
  GATE_CREATED: 'Location added',
  GATE_UPDATED: 'Location changed',
  USER_CREATED: 'Account added',
  USER_UPDATED: 'Account changed',
  USER_DELETED: 'Account deleted',
  USER_PASSWORD_RESET: 'Password reset',
  TICKET_REPRINTED: 'Ticket reprinted',
  PAYMENT_CASH_CONFIRMED: 'Cash confirmed',
  PAYMENT_CANCELLED: 'Card payment cancelled',
};
