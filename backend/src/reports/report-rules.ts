import { BadRequestException } from '@nestjs/common';

/**
 * Pure rules behind the admin reports (Sprint 5a), tested in
 * report-rules.test.ts. No I/O here.
 */

/**
 * Hardening H5: a CSV covers at most this many Lagos days (about three
 * months) and needs both dates. The CSV is streamed, so this is the owner's
 * choice of range, not a memory guard.
 */
export const CSV_MAX_DAYS = 92;

/** A JSON report page covers at most this many Lagos days (as before H5). */
export const JSON_MAX_DAYS = 366;

/**
 * Hardening H5: the most data rows one CSV holds, Excel's limit (1,048,576
 * rows less the header). More is refused with the count, never cut short.
 */
export const EXCEL_MAX_ROWS = 1_048_575;

/** Paging for the list routes. */
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

// ---------------------------------------------------------------- money

/** Integer kobo as plain naira for a CSV number cell: "1234.56". String work only, no grouping. */
export function nairaPlain(kobo: number | bigint): string {
  if (typeof kobo === 'number' && !Number.isSafeInteger(kobo)) throw new Error('kobo must be a safe integer');
  const digits = kobo.toString();
  if (digits.startsWith('-')) throw new Error('kobo must not be negative');
  const padded = digits.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

// ---------------------------------------------------------------- CSV

export type CellKind = 'text' | 'amount' | 'int';

const FORMULA_START = /^[=+\-@\t\r]/;
const AMOUNT = /^\d+\.\d{2}$/;
const INT = /^\d+$/;

/**
 * One CSV cell. Text that a spreadsheet could read as a formula (starting with
 * = + - @, a tab or a CR) gets a leading apostrophe; amount and integer cells
 * are never touched, and must be plain non-negative numbers.
 */
export function csvCell(value: string | number | null | undefined, kind: CellKind): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (kind === 'amount' && !AMOUNT.test(text)) throw new Error('not an amount');
  if (kind === 'int' && !INT.test(text)) throw new Error('not an integer');
  if (kind !== 'text') return text;
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A whole CSV: UTF-8 byte-order mark (Excel reads the ₦ and accents), CRLF line ends. */
export function csvDocument(header: string[], rows: string[][]): string {
  const head = header.map((h) => csvCell(h, 'text')).join(',');
  return '﻿' + [head, ...rows.map((r) => r.join(','))].map((l) => `${l}\r\n`).join('');
}

// ---------------------------------------------------------------- time

const LAGOS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Lagos's offset from UTC in ms during the UTC hour starting at [hourMs], from Intl (the time-zone database). */
function lagosOffsetMs(hourMs: number): number {
  const p = Object.fromEntries(LAGOS.formatToParts(new Date(hourMs)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - hourMs;
}

/**
 * Offsets per UTC hour, so a 50,000-row CSV makes a few hundred Intl calls, not
 * 150,000 (Sprint 5a speed check). Time-zone offsets change on whole hours.
 */
const OFFSETS = new Map<number, number>();

const two = (v: number) => String(v).padStart(2, '0');

/** A backend instant as Lagos time, "YYYY-MM-DD HH:MM"; "" for none. */
export function lagosStamp(at: Date | null | undefined): string {
  if (!at) return '';
  const ms = at.getTime();
  const hour = Math.floor(ms / 3_600_000) * 3_600_000;
  let offset = OFFSETS.get(hour);
  if (offset === undefined) {
    if (OFFSETS.size > 20_000) OFFSETS.clear();
    offset = lagosOffsetMs(hour);
    OFFSETS.set(hour, offset);
  }
  const l = new Date(ms + offset);
  return `${l.getUTCFullYear()}-${two(l.getUTCMonth() + 1)}-${two(l.getUTCDate())} ${two(l.getUTCHours())}:${two(l.getUTCMinutes())}`;
}

// ---------------------------------------------------------------- date ranges

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function realDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * A report's Lagos-day range. JSON: defaults to today, at most JSON_MAX_DAYS.
 * CSV: both dates required, at most CSV_MAX_DAYS. [today] is the database's
 * Lagos date.
 */
export function parseRange(q: { from?: string; to?: string }, today: string, csv: boolean): { from: string; to: string } {
  if (csv && (!q.from || !q.to)) throw new BadRequestException('A CSV needs from and to (YYYY-MM-DD, Lagos days).');
  const from = q.from ?? q.to ?? today;
  const to = q.to ?? q.from ?? today;
  if (!realDay(from) || !realDay(to)) throw new BadRequestException('from and to must be dates: YYYY-MM-DD.');
  if (from > to) throw new BadRequestException('from must not be after to.');
  const days = daysBetween(from, to);
  if (csv && days > CSV_MAX_DAYS) {
    throw new BadRequestException(`A CSV covers at most ${CSV_MAX_DAYS} days (about three months). Choose a shorter range.`);
  }
  if (days > JSON_MAX_DAYS) throw new BadRequestException(`A report covers at most ${JSON_MAX_DAYS} days.`);
  return { from, to };
}

const grouped = (v: number) => v.toLocaleString('en-US');

/** null when [rows] may go into one CSV (at most [limit], Excel's by default); otherwise why not, with the count. */
export function rowLimitProblem(rows: number, limit: number = EXCEL_MAX_ROWS): string | null {
  return rows > limit
    ? `This range has ${grouped(rows)} rows; a CSV holds at most ${grouped(limit)} (the most Excel can open). Choose a shorter range, for example one month at a time.`
    : null;
}

// ---------------------------------------------------------------- people

/** An operator as reports show them; a deleted one stays, marked. */
export function personLabel(name: string | null | undefined, deletedAt: Date | null | undefined): string {
  if (!name) return '';
  return deletedAt ? `${name} (deleted)` : name;
}

// ---------------------------------------------------------------- audit

/**
 * The audit view's detail: an ALLOW-LIST of fields per action, never the raw
 * JSON. A cash confirmation's payment reference is not shown; nothing nested
 * passes except a reprint's issuedBy username.
 */
const AUDIT_FIELDS: Record<string, string[]> = {
  CATEGORY_CREATED: ['code', 'name', 'priceKobo'],
  CATEGORY_UPDATED: ['code', 'name', 'isActive'],
  CATEGORY_PRICE_CHANGED: ['code', 'priceKobo'],
  SETTINGS_CHANGED: ['displayName', 'paymentWindowMinutes', 'receiptOrgName', 'receiptContactLine'],
  GATE_CREATED: ['code', 'name', 'direction'],
  GATE_UPDATED: ['code', 'name', 'isActive'],
  USER_CREATED: ['username', 'role', 'gateCode'],
  USER_UPDATED: ['username', 'name', 'role', 'gateCode', 'isActive'],
  USER_DELETED: ['username', 'role'],
  USER_PASSWORD_RESET: ['username'],
  TICKET_REPRINTED: ['ticketNumber', 'issuedBy'],
  PAYMENT_CASH_CONFIRMED: ['ticketNumber', 'amountKobo'],
  PAYMENT_CANCELLED: ['ticketNumber', 'forced'],
  // Hardening H1: never the typed username, the password or the address (none is stored).
  LOGIN_THROTTLED: ['scope', 'failures', 'windowMinutes', 'blockedSeconds'],
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_FIELDS);

type Scalar = string | number | boolean | null;
export interface AuditField {
  field: string;
  value?: Scalar;
  from?: Scalar;
  to?: Scalar;
}

const MAX_TEXT = 200;

function scalar(v: unknown): Scalar | undefined {
  if (v === null) return null;
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT - 1)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

export function auditDetail(action: string, detail: unknown): AuditField[] {
  const fields = AUDIT_FIELDS[action];
  if (!fields || !detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const d = detail as Record<string, unknown>;
  const out: AuditField[] = [];
  for (const field of fields) {
    if (!(field in d)) continue;
    const raw = d[field];
    if (field === 'issuedBy' && raw && typeof raw === 'object') {
      const u = scalar((raw as Record<string, unknown>).username);
      if (typeof u === 'string') out.push({ field, value: u });
      continue;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'from' in raw && 'to' in raw) {
      const from = scalar((raw as Record<string, unknown>).from);
      const to = scalar((raw as Record<string, unknown>).to);
      if (from !== undefined && to !== undefined) out.push({ field, from, to });
      continue;
    }
    const v = scalar(raw);
    if (v !== undefined) out.push({ field, value: v });
  }
  return out;
}
