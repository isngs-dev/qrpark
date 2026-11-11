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
          {csv ? (
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
