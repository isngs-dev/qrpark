import Link from 'next/link';
import { lagosDay, lagosTime, naira } from '@/lib/config-types';
import { getTransaction } from '@/lib/reports';
import { METHOD_LABELS, STATE_LABELS, dayLabel } from '@/lib/reports-types';
import { Refused, ReportFrame } from '../../report-frame';
import { Block, Empty, Pill, TableWrap, Td, Th, Tr } from '../../ui';

export const metadata = { title: 'Ticket · QR Parking Admin' };

/**
 * One ticket's story (Sprint 5c): every payment attempt with our payment
 * reference (to find it in the Paystack dashboard), every scan and reprint.
 * Read-only. Every value is the backend's.
 */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTransaction(id);
  if (!result.ok) return <Refused message={result.status === 404 ? 'No ticket found.' : result.message} />;
  const { ticket: t, payments, scans, reprints } = result.data;

  return (
    <ReportFrame title={`Ticket ${t.ticketNumber}`} range={{ day: lagosDay(t.issuedAt) }}>
      <p className="mb-4 text-sm">
        <Link href="/transactions" className="text-accent underline">← Transactions</Link>
      </p>

      <Block title="The ticket">
        <TableWrap>
          <tbody>
            <Tr><Td>Vehicle</Td><Td>{t.categoryName} ({t.categoryCode})</Td></Tr>
            <Tr><Td>Fee (fixed when issued)</Td><Td variant="amount">{naira(t.feeKobo)}</Td></Tr>
            <Tr><Td>State</Td><Td>{STATE_LABELS[t.state]}</Td></Tr>
            <Tr><Td>Issued</Td><Td>{lagosTime(t.issuedAt)} at {t.entryGate?.name} by {t.issuedBy?.label}</Td></Tr>
            <Tr><Td>Valid until</Td><Td>{lagosTime(t.validUntil)} (the end of {dayLabel(lagosDay(t.issuedAt))}, Lagos)</Td></Tr>
            <Tr><Td>Paid</Td><Td>{t.paymentMethod ? `${METHOD_LABELS[t.paymentMethod]} at ${t.booth?.name}, ${lagosTime(t.paidAt)}, by ${t.paidBy?.label}` : 'Not paid'}</Td></Tr>
            <Tr><Td>Left</Td><Td>{t.validatedAt ? `${lagosTime(t.validatedAt)} at ${t.exitGate?.name}, by ${t.validatedBy?.label}` : 'Not validated at an exit'}</Td></Tr>
          </tbody>
        </TableWrap>
      </Block>

      <Block title="Payment attempts" aside="Only a SUCCESS payment is revenue">
        {payments.length === 0 ? (
          <Empty>No payment attempt.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr><Th>Started</Th><Th>Method</Th><Th>Status</Th><Th align="right">Amount</Th><Th>Booth</Th><Th>Operator</Th><Th>Reference</Th><Th>Revenue</Th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{lagosTime(p.createdAt)}</Td>
                  <Td>{METHOD_LABELS[p.method]}</Td>
                  <Td>
                    {p.status}
                    {p.paidAt ? <span className="block text-xs text-ink-soft">paid {lagosTime(p.paidAt)}</span> : null}
                    {p.cancelledAt ? <span className="block text-xs text-ink-soft">cancelled {lagosTime(p.cancelledAt)}{p.forced ? ' (forced: Paystack could not be reached)' : ''}</span> : null}
                  </Td>
                  <Td variant="amount">{naira(p.amountKobo)}</Td>
                  <Td>{p.booth?.name}</Td>
                  <Td>{p.operator?.label}</Td>
                  <Td variant="mono">{p.reference}</Td>
                  <Td>{p.countedAsRevenue ? <Pill tone="good">counted</Pill> : <Pill tone="pending">not revenue</Pill>}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Block>

      <Block title="Scans">
        {scans.length === 0 ? (
          <Empty>No scan.</Empty>
        ) : (
          <TableWrap>
            <thead><tr><Th>When</Th><Th>Kind</Th><Th>Result</Th><Th>Where</Th><Th>Operator</Th></tr></thead>
            <tbody>
              {scans.map((s, i) => (
                <Tr key={i}><Td>{lagosTime(s.occurredAt)}</Td><Td>{s.kind}</Td><Td>{s.result}</Td><Td>{s.gate?.name}</Td><Td>{s.operator?.label}</Td></Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Block>

      <Block title="Reprints">
        {reprints.length === 0 ? (
          <Empty>Never reprinted.</Empty>
        ) : (
          <TableWrap>
            <thead><tr><Th>When</Th><Th>By</Th></tr></thead>
            <tbody>
              {reprints.map((x, i) => (
                <Tr key={i}><Td>{lagosTime(x.occurredAt)}</Td><Td>{x.by?.label}</Td></Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Block>
    </ReportFrame>
  );
}

