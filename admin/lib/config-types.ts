/**
 * Configuration shapes and display helpers that touch no server (pure).
 *
 * Adapted from eparking admin/lib/config-types.ts (359c0c1): the eparking-only
 * shapes (pricing rules, pass plans, devices) are gone; a category carries its
 * flat price; locations have three kinds. `naira` is now string work, as the
 * Sprint 5 rules require, and `lagosTime` replaces the zone helpers.
 *
 * Amounts are integer kobo exactly as the backend returns them. Nothing here
 * computes a price: `naira` only formats one, and `koboFromNaira` is the unit
 * conversion of a price an admin typed.
 */

export interface Category {
  id: string;
  code: string;
  name: string;
  priceKobo: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  displayName: string;
  paymentWindowMinutes: number;
  receiptOrgName: string | null;
  receiptContactLine: string | null;
  updatedAt: string;
  /** Read-only, from the backend's environment: "test" or "not configured". */
  paystackMode: string;
}

export type LocationKind = 'ENTRY' | 'BOOTH' | 'EXIT';

export const LOCATION_KINDS: LocationKind[] = ['ENTRY', 'BOOTH', 'EXIT'];

export const LOCATION_LABELS: Record<LocationKind, string> = {
  ENTRY: 'Entry gate',
  BOOTH: 'Payment booth',
  EXIT: 'Exit gate',
};

export interface Gate {
  id: string;
  code: string;
  name: string;
  direction: LocationKind;
  isActive: boolean;
}

/** Integer kobo as "₦1,234.56". String work on the digits only; never a division. */
export function naira(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new Error('kobo must be a non-negative safe integer');
  const digits = String(kobo).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${whole}.${digits.slice(-2)}`;
}

/** The backend's price limit (a PostgreSQL integer). */
const MAX_KOBO = 2_147_483_647;

/**
 * A price an admin typed in naira, as integer kobo, by digits: "1,200.5" is
 * 120050. Null (refused) for anything that is not a plain positive amount with
 * at most two decimals.
 */
export function koboFromNaira(typed: string): number | null {
  const cleaned = typed.trim().replace(/^₦/, '').replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const fraction = (m[2] ?? '').padEnd(2, '0');
  if (whole.length > 9) return null;
  const kobo = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(kobo) || kobo < 1 || kobo > MAX_KOBO) return null;
  return kobo;
}

const LAGOS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A backend instant in Lagos time, "08 Nov 2026, 00:30", whatever the reader's clock. */
export function lagosTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = Object.fromEntries(LAGOS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}
