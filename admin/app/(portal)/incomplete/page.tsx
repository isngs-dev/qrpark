import { getIncomplete, todayFor } from '@/lib/reports';
import { INCOMPLETE_LABELS, csvHref, dayLabel } from '@/lib/reports-types';
import { RangeChips, RangeFields, Refused, ReportFrame, ShowButton } from '../report-frame';
import { Empty, Pill, TableWrap, Td, Th, Tile, Tiles, Tr } from '../ui';

export const metadata = { title: 'Incomplete sessions · QR Parking Admin' };

/**
 * Tickets never validated at an exit (Sprint 5c), grouped by issue day, entry
 * gate, paying booth, issuing operator and status, as the backend groups them.
 */
export default async function IncompletePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const result = await getIncomplete(input);
  if (!result.ok) return <Refused message={result.message} />;
  const r = result.data;
  const today = await todayFor(input, r);

  return (
    <ReportFrame
      title="Incomplete sessions"
      range={r}
      csv={csvHref('incomplete', r, input)}
      explain={
        <>
          Tickets issued in the range that never left through an exit.{' '}
          {"In progress = today's tickets, never validated = earlier days."} A ticket is valid on its day of issue only. Unpaid tickets have no booth: they are listed under &quot;Unpaid (no
          booth)&quot;.
        </>
      }
    >
      <RangeChips path="/incomplete" input={input} range={r} today={today} />
      <form id="range" method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <RangeFields range={r} />
        <ShowButton />
      </form>

      <Tiles>
        <Tile period="Not validated" total={String(r.totals.count)} />
        <Tile period={INCOMPLETE_LABELS.IN_PROGRESS} total={String(r.totals.inProgress)} />
        <Tile period={INCOMPLETE_LABELS.NEVER_VALIDATED} total={String(r.totals.neverValidated)} />
      </Tiles>

      {r.groups.length === 0 ? (
        <Empty>Every ticket in the range left through an exit.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr><Th>Issued on</Th><Th>Entry gate</Th><Th>Booth</Th><Th>Issued by</Th><Th>Status</Th><Th align="right">Tickets</Th><Th align="right">Paid</Th><Th align="right">Unpaid</Th></tr>
          </thead>
          <tbody>
            {r.groups.map((g, i) => (
              <Tr key={i}>
                <Td>{dayLabel(g.day)}</Td>
                <Td>{g.entryGate?.name}</Td>
                <Td>{g.boothLabel}</Td>
                <Td>{g.operator?.label}</Td>
                <Td>{g.status === 'IN_PROGRESS' ? <Pill tone="pending">{INCOMPLETE_LABELS.IN_PROGRESS}</Pill> : <Pill tone="bad">{INCOMPLETE_LABELS.NEVER_VALIDATED}</Pill>}</Td>
                <Td variant="amount">{g.count}</Td>
                <Td variant="amount">{g.paidCount}</Td>
                <Td variant="amount">{g.unpaidCount}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </ReportFrame>
  );
}
