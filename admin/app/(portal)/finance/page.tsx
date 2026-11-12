import { lagosTime, naira } from '@/lib/config-types';
import { getFinance, todayFor } from '@/lib/reports';
import { csvHref, dayLabel, rangeLabel, type Split } from '@/lib/reports-types';
import { barWidths, shareLabels } from '@/lib/shares';
import { RangeChips, RangeFields, Refused, ReportFrame, ShowButton } from '../report-frame';
import { Bar, CashCardTiles, CategoryBars, ChartDefs, ColumnChart, KpiRow, Panel, type Column } from '../charts';
import { Block, Empty, TableWrap, Td, Th, Tr } from '../ui';

export const metadata = { title: 'Finance · QR Parking Admin' };

/**
 * Revenue (Sprint 5c): SUCCESS payments only, cash and card apart and in
 * total, by day, booth and operator, exactly as the backend sums them. The
 * cash per booth and per operator is what the physical cash is checked
 * against. DUPLICATE and cancelled card payments are listed apart, never
 * counted. Nothing here computes an amount.
 *
 * UI-1: the analytics. Key figures against the period just before, the trend
 * in the backend's buckets, the hour of day and the vehicle types, all summed
 * by the backend; charts.tsx draws them.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const result = await getFinance(input);
  if (!result.ok) return <Refused message={result.message} />;
  const r = result.data;
  const today = await todayFor(input, r);
  const cells = (s: Split) => (
    <>
      <Td variant="amount">{s.cash.count}</Td>
      <Td variant="amount">{naira(s.cash.kobo)}</Td>
      <Td variant="amount">{s.card.count}</Td>
      <Td variant="amount">{naira(s.card.kobo)}</Td>
      <Td variant="amount">{naira(s.total.kobo)}</Td>
    </>
  );
  const head = (first: string, share?: boolean) => (
    <thead>
      <tr><Th>{first}</Th><Th align="right">Cash payments</Th><Th align="right">Cash</Th><Th align="right">Card payments</Th><Th align="right">Card</Th><Th align="right">Total</Th>{share ? <Th>Share of revenue</Th> : null}</tr>
    </thead>
  );
  // UI-1 (P3): each row's share of the revenue, and a bar against the largest row. Display only.
  const share = (rows: Split[]) => {
    const parts = rows.map((x) => x.total.kobo);
    const labels = shareLabels(parts);
    const widths = barWidths(parts);
    return (i: number) => (
      <td className="w-[180px] min-w-[140px] border-b border-line-soft px-3.5 py-[11px] last:border-b-0">
        <div className="flex items-center gap-2">
          <div className="flex-1"><Bar width={widths[i]} /></div>
          <span className="num w-[52px] text-right font-mono text-[12px] text-ink-soft">{labels[i]}</span>
        </div>
      </td>
    );
  };
  const boothShare = share(r.byBooth);
  const opShare = share(r.byOperator);

  // The trend's columns, labelled by the backend's bucket. A day is "4 Nov"; a week by its first day; a month by its name.
  const short = (day: string) => dayLabel(day).replace(/ \d{4}$/, '');
  const per = { day: 'day', week: 'week', month: 'month' }[r.trend.bucket];
  const trend: Column[] = r.trend.buckets.map((b) => ({
    key: b.start,
    tick: r.trend.bucket === 'month' ? dayLabel(b.start).split(' ')[1] : short(b.start),
    title: r.trend.bucket === 'day' ? dayLabel(b.start) : rangeLabel({ from: b.start, to: b.end }),
    cash: b.cash, card: b.card, total: b.total,
  }));
  const hh = (h: number) => String(h).padStart(2, '0');
  const hours: Column[] = r.byHour.map((h) => ({
    key: String(h.hour), tick: hh(h.hour), title: `${hh(h.hour)}:00–${hh(h.hour)}:59`, cash: h.cash, card: h.card, total: h.total,
  }));
  const oneDay = r.from === r.to;

  return (
    <ReportFrame
      title="Finance"
      range={r}
      csv={csvHref('finance', r, input)}
      explain={
        <>
          A payment counts on the Lagos day it was recorded as paid (not the day its ticket was issued). Only successful payments are
          revenue. Cash is what the booth operator confirmed; the system cannot see the cash itself, so compare the cash per booth
          and per operator below with the cash counted.
        </>
      }
    >
      <RangeChips path="/finance" input={input} range={r} today={today} />
      <form id="range" method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <RangeFields range={r} />
        <ShowButton />
      </form>

      <ChartDefs />
      <KpiRow total={r.total} previous={r.previous} kpis={r.kpis} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {oneDay ? (
          <Panel title="Revenue by hour (Lagos)" aside={`${dayLabel(r.from)}, payments by the hour they were recorded`} className="lg:col-span-2">
            <ColumnChart columns={hours} label={`Revenue by hour on ${dayLabel(r.from)}, cash and card stacked`} empty="No payments on this day" />
          </Panel>
        ) : (
          <Panel title={`Revenue by ${per} (Lagos)`} aside={`${trend.length} ${per}s, cash and card stacked`} className="lg:col-span-2">
            <ColumnChart columns={trend} label={`Revenue by ${per}, ${rangeLabel(r)}, cash and card stacked`} empty="No payments in this range" />
          </Panel>
        )}
        <CashCardTiles total={r.total} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {oneDay ? null : (
          <Panel title="Busiest hours (Lagos)" aside="Revenue by the hour each payment was recorded, all days together">
            <ColumnChart columns={hours} label={`Revenue by hour of day, ${rangeLabel(r)}, cash and card stacked`} empty="No payments in this range" height={200} />
          </Panel>
        )}
        <Panel title="Vehicle types" aside="Revenue, largest first" className={oneDay ? 'lg:col-span-2' : ''}>
          <CategoryBars rows={r.byCategory} />
        </Panel>
      </div>

      <Block title="By booth" aside="Compare the cash with the cash counted at each booth">
        {r.byBooth.length === 0 ? <Empty>No payment in the range.</Empty> : (
          <TableWrap>{head('Booth', true)}<tbody>{r.byBooth.map((b, i) => <Tr key={b.booth.id}><Td>{b.booth.name} ({b.booth.code})</Td>{cells(b)}{boothShare(i)}</Tr>)}</tbody></TableWrap>
        )}
      </Block>

      <Block title="By operator" aside="Who confirmed each payment">
        {r.byOperator.length === 0 ? <Empty>No payment in the range.</Empty> : (
          <TableWrap>{head('Operator', true)}<tbody>{r.byOperator.map((o, i) => <Tr key={o.operator.id}><Td>{o.operator.label}</Td>{cells(o)}{opShare(i)}</Tr>)}</tbody></TableWrap>
        )}
      </Block>

      {/* The charts' figures in words: every bucket and every day, as the backend summed them. */}
      <details className="group mb-6 rounded-card border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
          Figures by {per} and by day <span className="font-normal text-ink-soft">({r.byDay.length} days; every day of the range, a day with no payment at ₦0.00)</span>
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {r.trend.bucket === 'day' ? null : (
            <TableWrap>{head(`${per[0].toUpperCase()}${per.slice(1)}`)}<tbody>{r.trend.buckets.map((b) => <Tr key={b.start}><Td>{rangeLabel({ from: b.start, to: b.end })}</Td>{cells(b)}</Tr>)}</tbody></TableWrap>
          )}
          <TableWrap>{head('Day')}<tbody>{r.byDay.map((d) => <Tr key={d.day}><Td>{dayLabel(d.day)}</Td>{cells(d)}</Tr>)}</tbody></TableWrap>
        </div>
      </details>

      <Block title="Duplicate card payments: not revenue" aside="Paystack took the money for a ticket already paid: refund it in the Paystack dashboard">
        {r.duplicates.length === 0 ? <Empty>None in the range.</Empty> : (
          <TableWrap>
            <thead><tr><Th>Paystack paid</Th><Th>Ticket</Th><Th align="right">Amount</Th><Th>Booth</Th><Th>Operator</Th><Th>Reference</Th></tr></thead>
            <tbody>
              {r.duplicates.map((d) => (
                <Tr key={d.reference}><Td>{lagosTime(d.paystackPaidAt)}</Td><Td variant="mono">{d.ticketNumber}</Td><Td variant="amount">{naira(d.amountKobo)}</Td><Td>{d.booth?.name}</Td><Td>{d.operator?.label}</Td><Td variant="mono">{d.reference}</Td></Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Block>

      <Block title="Card payments cancelled at the booth: not revenue" aside="The customer gave up on the card; the ticket was paid another way or not at all">
        {r.cancelled.length === 0 ? <Empty>None in the range.</Empty> : (
          <TableWrap>
            <thead><tr><Th>Cancelled</Th><Th>Ticket</Th><Th align="right">Amount</Th><Th>Booth</Th><Th>Operator</Th><Th>Reference</Th><Th>How</Th></tr></thead>
            <tbody>
              {r.cancelled.map((c) => (
                <Tr key={c.reference}><Td>{lagosTime(c.cancelledAt)}</Td><Td variant="mono">{c.ticketNumber}</Td><Td variant="amount">{naira(c.amountKobo)}</Td><Td>{c.booth?.name}</Td><Td>{c.operator?.label}</Td><Td variant="mono">{c.reference}</Td><Td>{c.forced ? 'Forced: Paystack could not be reached' : 'Cancelled at the booth'}</Td></Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Block>
    </ReportFrame>
  );
}
