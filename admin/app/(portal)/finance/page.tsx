import { lagosTime, naira } from '@/lib/config-types';
import { getFinance } from '@/lib/reports';
import { csvHref, dayLabel, type Split } from '@/lib/reports-types';
import { RangeFields, Refused, ReportFrame, ShowButton } from '../report-frame';
import { Block, Empty, TableWrap, Td, Th, Tile, Tiles, Tr } from '../ui';

export const metadata = { title: 'Finance · QR Parking Admin' };

/**
 * Revenue (Sprint 5c): SUCCESS payments only, cash and card apart and in
 * total, by day, booth and operator, exactly as the backend sums them. The
 * cash per booth and per operator is what the physical cash is checked
 * against. DUPLICATE and cancelled card payments are listed apart, never
 * counted. Nothing here computes an amount.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const result = await getFinance(input);
  if (!result.ok) return <Refused message={result.message} />;
  const r = result.data;
  const cells = (s: Split) => (
    <>
      <Td variant="amount">{s.cash.count}</Td>
      <Td variant="amount">{naira(s.cash.kobo)}</Td>
      <Td variant="amount">{s.card.count}</Td>
      <Td variant="amount">{naira(s.card.kobo)}</Td>
      <Td variant="amount">{naira(s.total.kobo)}</Td>
    </>
  );
  const head = (first: string) => (
    <thead>
      <tr><Th>{first}</Th><Th align="right">Cash payments</Th><Th align="right">Cash</Th><Th align="right">Card payments</Th><Th align="right">Card</Th><Th align="right">Total</Th></tr>
    </thead>
  );

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
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <RangeFields range={r} />
        <ShowButton />
      </form>

      <Tiles>
        <Tile period="Revenue" total={naira(r.total.total.kobo)} breakdown={[{ label: `Cash (${r.total.cash.count})`, value: naira(r.total.cash.kobo) }, { label: `Card (${r.total.card.count})`, value: naira(r.total.card.kobo) }]} />
      </Tiles>

      <Block title="By booth" aside="Compare the cash with the cash counted at each booth">
        {r.byBooth.length === 0 ? <Empty>No payment in the range.</Empty> : (
          <TableWrap>{head('Booth')}<tbody>{r.byBooth.map((b) => <Tr key={b.booth.id}><Td>{b.booth.name} ({b.booth.code})</Td>{cells(b)}</Tr>)}</tbody></TableWrap>
        )}
      </Block>

      <Block title="By operator" aside="Who confirmed each payment">
        {r.byOperator.length === 0 ? <Empty>No payment in the range.</Empty> : (
          <TableWrap>{head('Operator')}<tbody>{r.byOperator.map((o) => <Tr key={o.operator.id}><Td>{o.operator.label}</Td>{cells(o)}</Tr>)}</tbody></TableWrap>
        )}
      </Block>

      <Block title="By day (Lagos)">
        {r.byDay.length === 0 ? <Empty>No payment in the range.</Empty> : (
          <TableWrap>{head('Day')}<tbody>{r.byDay.map((d) => <Tr key={d.day}><Td>{dayLabel(d.day)}</Td>{cells(d)}</Tr>)}</tbody></TableWrap>
        )}
      </Block>

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
