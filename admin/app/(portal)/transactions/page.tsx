import Link from 'next/link';
import { getCategories, getGates } from '@/lib/config';
import { lagosTime, naira } from '@/lib/config-types';
import { getTransactions, pageFrom } from '@/lib/reports';
import { METHOD_LABELS, STATE_LABELS, csvHref, pageLinks } from '@/lib/reports-types';
import { getUsers } from '@/lib/users';
import { Pager } from '../pager';
import { RangeFields, Refused, ReportFrame, ShowButton } from '../report-frame';
import { Empty, TableWrap, Td, Th, Tr } from '../ui';

export const metadata = { title: 'Transactions · QR Parking Admin' };

/**
 * Every ticket in the range and what happened to it (Sprint 5c). Search by the
 * end of the ticket number, filter, page by number; each row opens the ticket's
 * story. Filters are a GET form (an address that can be kept), never a Server
 * Action. Every value is the backend's.
 */
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const page = pageFrom(input);
  const [result, categories, gates, users] = await Promise.all([getTransactions(input, page), getCategories(), getGates(), getUsers()]);
  if (!result.ok) return <Refused message={result.message} />;
  const r = result.data;
  const value = (k: string) => (Array.isArray(input[k]) ? input[k]?.[0] : input[k]) ?? '';
  const select = (name: string, label: string, options: Array<{ value: string; label: string }>) => (
    <label className="text-xs text-ink-soft">
      {label}
      <select name={name} defaultValue={value(name)} className="mt-1 block rounded border border-line px-2 py-1 text-sm">
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
  const gatesOf = (kind: string) => (gates.ok ? gates.data.filter((g) => g.direction === kind).map((g) => ({ value: g.code, label: g.name })) : []);

  return (
    <ReportFrame title="Transactions" range={r} csv={csvHref('transactions', r, input)} explain="One row per ticket, on the Lagos day it was issued. Open a ticket to see every payment attempt, scan and reprint.">
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <RangeFields range={r} />
        <label className="text-xs text-ink-soft">
          Ticket number ends with
          <input name="q" defaultValue={value('q')} maxLength={9} placeholder="e.g. 3QZ9" className="mt-1 block w-28 rounded border border-line px-2 py-1 text-sm uppercase" />
        </label>
        {select('state', 'State', Object.entries(STATE_LABELS).map(([v, l]) => ({ value: v, label: l })))}
        {select('category', 'Vehicle type', categories.ok ? categories.data.map((c) => ({ value: c.code, label: c.name })) : [])}
        {select('entryGate', 'Entry gate', gatesOf('ENTRY'))}
        {select('booth', 'Booth', gatesOf('BOOTH'))}
        {select('method', 'Paid by', [{ value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }])}
        {select('operator', 'Operator', users.ok ? users.data.map((u) => ({ value: u.id, label: u.name })) : [])}
        <ShowButton />
        <Link href="/transactions" className="pb-1.5 text-sm text-accent underline">Clear</Link>
      </form>

      {r.rows.length === 0 ? (
        <Empty>No tickets match.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Ticket</Th><Th>Issued</Th><Th>Vehicle</Th><Th align="right">Fee</Th><Th>State</Th><Th>Paid</Th><Th>Booth</Th><Th>Paid to</Th><Th>Left</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((t) => (
              <Tr key={t.id}>
                <Td variant="mono"><Link className="text-accent underline" href={`/transactions/${t.id}`}>{t.ticketNumber}</Link></Td>
                <Td>{lagosTime(t.issuedAt)}<span className="block text-xs text-ink-soft">{t.entryGate?.name} · {t.issuedBy?.label}</span></Td>
                <Td>{t.categoryName}</Td>
                <Td variant="amount">{naira(t.feeKobo)}</Td>
                <Td>{STATE_LABELS[t.state]}</Td>
                <Td>{t.paymentMethod ? `${METHOD_LABELS[t.paymentMethod]}, ${lagosTime(t.paidAt)}` : '—'}</Td>
                <Td>{t.booth?.name ?? '—'}</Td>
                <Td>{t.paidBy?.label ?? '—'}</Td>
                <Td>{t.validatedAt ? `${lagosTime(t.validatedAt)}, ${t.exitGate?.name ?? ''}` : '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pager links={pageLinks('/transactions', input, r)} noun="tickets" />
    </ReportFrame>
  );
}
