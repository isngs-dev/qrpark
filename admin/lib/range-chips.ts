/**
 * The quick range chips (UI-1, P2). Pure; tested in tests/range-chips.test.ts.
 * Written new.
 *
 * Every range is worked out from the BACKEND's Lagos today ("YYYY-MM-DD") by
 * calendar arithmetic on the date alone: the portal's clock is never read.
 * Weeks start on Monday.
 */

import type { Range } from './reports-types';

/** The backend's limits (docs/api.md "Shared rules"): a JSON page, and a CSV. */
export const JSON_MAX_DAYS = 366;
export const CSV_MAX_DAYS = 92;

export type ChipKey = 'today' | 'yesterday' | 'week' | 'last7' | 'month' | 'lastMonth';

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" as a day number (days since 1970-01-01), and back. Calendar work, no clock. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function dayText(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) => dayText(dayNumber(day) + n);

/** Monday 0 ... Sunday 6. 1970-01-01 was a Thursday. */
const weekday = (day: string) => (((dayNumber(day) + 3) % 7) + 7) % 7;

export function chipRanges(today: string): Array<{ key: ChipKey; label: string } & Range> {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: 'week', label: 'This week', from: addDays(today, -weekday(today)), to: today },
    { key: 'last7', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'lastMonth', label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

/** The Dashboard shows one day: Today and Yesterday (any other day is Custom). */
export function dayChips(today: string): Array<{ key: 'today' | 'yesterday'; label: string; day: string }> {
  return [
    { key: 'today', label: 'Today', day: today },
    { key: 'yesterday', label: 'Yesterday', day: addDays(today, -1) },
  ];
}

/** The chip whose range is on screen, the first that matches; otherwise Custom. */
export function activeChip(range: Range, today: string): ChipKey | 'custom' {
  return chipRanges(today).find((c) => c.from === range.from && c.to === range.to)?.key ?? 'custom';
}

type Input = Record<string, string | string[] | undefined>;

/** A chip's link: the page's own filters kept (first value, empty dropped), no page number, the chip's from and to. */
export function chipHref(path: string, input: Input, range: Range): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    const value = (Array.isArray(v) ? v[0] : v)?.trim();
    if (value && k !== 'page' && k !== 'from' && k !== 'to') q.set(k, value);
  }
  q.set('from', range.from);
  q.set('to', range.to);
  return `${path}?${q.toString()}`;
}

/** How many Lagos days a range covers, both ends included. */
export const rangeDays = (range: Range) => dayNumber(range.to) - dayNumber(range.from) + 1;

/** Whether the backend would give this range as a CSV. */
export const csvFits = (range: Range) => rangeDays(range) <= CSV_MAX_DAYS;
