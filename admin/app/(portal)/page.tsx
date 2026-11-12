import Link from 'next/link';
import { naira } from '@/lib/config-types';
import { getDashboard, todayFor } from '@/lib/reports';
import type { Split } from '@/lib/reports-types';
import { DayChips, Refused, ReportFrame, ShowButton } from './report-frame';
import { Tile, Tiles } from './ui';

export const metadata = { title: 'Dashboard · QR Parking Admin' };

/**
 * One Lagos day at a glance (Sprint 5c; replaces the 5b overview). With no day
 * chosen the portal sends none and the backend answers with its own today.
 * Every count and amount is the backend's.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const result = await getDashboard(input);
  if (!result.ok) return <Refused message={result.message} />;
  const d = result.data;
  const today = await todayFor(input, { from: d.day });
  const breakdown = (s: Split) => [
    { label: `Cash (${s.cash.count})`, value: naira(s.cash.kobo) },
    { label: `Card (${s.card.count})`, value: naira(s.card.kobo) },
  ];

  return (
    <ReportFrame
      title="Dashboard"
      range={{ day: d.day }}
      explain="Tickets are counted on the Lagos day they were issued; revenue on the Lagos day each payment was recorded as paid."
    >
      <DayChips day={d.day} today={today} />
      <form id="range" method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-soft">
          Day
          <input type="date" name="day" defaultValue={d.day} className="mt-1 block rounded border border-line px-2 py-1 text-sm" />
        </label>
        <ShowButton />
      </form>

      <Tiles>
        <Tile period="Revenue" total={naira(d.revenue.total.kobo)} breakdown={breakdown(d.revenue)} />
        <Tile
          period="Not revenue"
          total="Listed apart"
          breakdown={[
            { label: `Duplicate card (${d.notRevenue.duplicate.count})`, value: naira(d.notRevenue.duplicate.kobo) },
            { label: `Cancelled card (${d.notRevenue.cancelled.count})`, value: naira(d.notRevenue.cancelled.kobo) },
          ]}
        />
      </Tiles>

      <Tiles>
        <Tile period="Tickets issued" total={String(d.tickets.issued)} breakdown={[{ label: 'Paid', value: String(d.tickets.paid) }, { label: 'Unpaid', value: String(d.tickets.unpaid) }]} />
        <Tile period="Left (validated)" total={String(d.tickets.validated)} />
        <Tile period="In progress (not yet out)" total={String(d.tickets.inProgress)} />
        <Tile period="Never validated" total={String(d.tickets.neverValidated)} />
      </Tiles>

      <p className="text-xs text-ink-soft">
        Duplicate card payments (to refund in the Paystack dashboard) and card payments cancelled at the booth are not revenue and
        are never counted in it. See <Link className="text-accent underline" href="/finance">Finance</Link> for the lists.
      </p>
    </ReportFrame>
  );
}
