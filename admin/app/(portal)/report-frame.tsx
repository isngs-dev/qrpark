import Link from 'next/link';
import { CSV_MAX_DAYS, activeChip, chipHref, chipRanges, csvFits, dayChips } from '@/lib/range-chips';
import { rangeLabel, type Range } from '@/lib/reports-types';

/**
 * Every report page's frame (Sprint 5c, review condition 5): the title, the
 * range the BACKEND answered with, "Lagos time", the CSV link when there is
 * one, and the standing line that nothing here can change a payment.
 * Written new.
 */
export function ReportFrame({
  title,
  range,
  csv,
  explain,
  children,
}: {
  title: string;
  range: Range | { day: string };
  csv?: string;
  explain?: React.ReactNode;
  children: React.ReactNode;
}) {
  const shown = 'day' in range ? rangeLabel({ from: range.day, to: range.day }) : rangeLabel(range);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-[21px] font-bold text-ink">{title}</h1>
        <p className="text-[12.5px] text-ink-soft">
          {shown} · all times are Lagos time
          {csv && !('day' in range) && !csvFits(range) ? (
            <>
              {' · '}
              {/* UI-1: over the limit the backend would refuse the file, so there is no link to follow. */}
              <span className="font-medium text-ink">No CSV for more than {CSV_MAX_DAYS} days: choose a shorter range</span>{' '}
              <span className="text-ink-soft">(at most 92 days and 1,048,575 rows, the most Excel opens)</span>
            </>
          ) : csv ? (
            <>
              {' · '}
              {/* A plain link: it is a file download (the CSV route), not a page. */}
              <a href={csv} className="font-medium text-accent underline">
                Download CSV
              </a>{' '}
              <span className="text-ink-soft">(at most 92 days and 1,048,575 rows, the most Excel opens)</span>
            </>
          ) : null}
        </p>
      </div>
      {explain ? <div className="mb-4 rounded-[9px] bg-accent-wash px-4 py-3 text-[12.5px] text-accent">{explain}</div> : null}
      {children}
      <p className="mt-8 border-t border-line pt-3 text-xs text-ink-soft">
        Read-only. Nothing here can change a payment: there are no refunds, reversals or corrections in this system. A card refund
        is made in the Paystack dashboard.
      </p>
    </>
  );
}

/** The date-range filter, a plain GET form (never a Server Action). Empty means the backend's today. */
export function RangeFields({ range }: { range: Range }) {
  return (
    <>
      <label className="text-xs text-ink-soft">
        From
        <input type="date" name="from" defaultValue={range.from} className="mt-1 block rounded border border-line px-2 py-1 text-sm" />
      </label>
      <label className="text-xs text-ink-soft">
        To
        <input type="date" name="to" defaultValue={range.to} className="mt-1 block rounded border border-line px-2 py-1 text-sm" />
      </label>
    </>
  );
}

export function ShowButton() {
  return (
    <button type="submit" className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper">
      Show
    </button>
  );
}

/** A backend refusal, shown as written. */
export function Refused({ message }: { message: string }) {
  return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm whitespace-pre-line text-bad">{message}</p>;
}

type Input = Record<string, string | string[] | undefined>;

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap ${
    on ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink hover:border-ink-soft'
  }`;

/**
 * UI-1 (P2): quick ranges, worked out from the backend's Lagos [today] (null
 * when it could not be read: then only the date fields). Plain links, so a
 * chip is a GET like the form; the page's other filters are kept. "Custom"
 * goes to the date fields.
 */
export function RangeChips({ path, input, range, today }: { path: string; input: Input; range: Range; today: string | null }) {
  if (!today) return null;
  const on = activeChip(range, today);
  return (
    <nav aria-label="Quick ranges" className="mb-3 flex flex-wrap gap-2">
      {chipRanges(today).map((c) => (
        <Link key={c.key} href={chipHref(path, input, c)} className={chip(on === c.key)} aria-current={on === c.key ? 'page' : undefined}>
          {c.label}
        </Link>
      ))}
      <a href="#range" className={chip(on === 'custom')} aria-current={on === 'custom' ? 'page' : undefined}>
        Custom
      </a>
    </nav>
  );
}

/** The Dashboard's one-day chips: Today, Yesterday, or a custom day. */
export function DayChips({ day, today }: { day: string; today: string | null }) {
  if (!today) return null;
  const chips = dayChips(today);
  const on = chips.find((c) => c.day === day)?.key ?? 'custom';
  return (
    <nav aria-label="Quick days" className="mb-3 flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link key={c.key} href={`/?day=${c.day}`} className={chip(on === c.key)} aria-current={on === c.key ? 'page' : undefined}>
          {c.label}
        </Link>
      ))}
      <a href="#range" className={chip(on === 'custom')} aria-current={on === 'custom' ? 'page' : undefined}>
        Custom day
      </a>
    </nav>
  );
}
