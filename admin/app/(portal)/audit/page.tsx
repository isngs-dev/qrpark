import Link from 'next/link';
import { lagosTime, naira } from '@/lib/config-types';
import { getAudit, pageFrom, todayFor } from '@/lib/reports';
import { AUDIT_ACTION_LABELS, csvHref, pageLinks, type AuditRow } from '@/lib/reports-types';
import { getUsers } from '@/lib/users';
import { Pager } from '../pager';
import { RangeChips, RangeFields, Refused, ReportFrame, ShowButton } from '../report-frame';
import { ActivityList, ActivityMeta, ActivityRow, Empty } from '../ui';

export const metadata = { title: 'Audit log · QR Parking Admin' };

/**
 * Who changed what (Sprint 5c). The details are the backend's allow-list of
 * fields per action, never the raw record. Newest first, numbered pages.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const [result, users] = await Promise.all([getAudit(input, pageFrom(input)), getUsers()]);
  if (!result.ok) return <Refused message={result.message} />;
  const r = result.data;
  const today = await todayFor(input, r);
  const value = (k: string) => (Array.isArray(input[k]) ? input[k]?.[0] : input[k]) ?? '';

  return (
    <ReportFrame title="Audit log" range={r} csv={csvHref('audit', r, input)} explain="Every change to prices, settings, locations and accounts, every cash confirmation, reprint and card cancellation, with who did it.">
      <RangeChips path="/audit" input={input} range={r} today={today} />
      <form id="range" method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <RangeFields range={r} />
        <label className="text-xs text-ink-soft">
          What
          <select name="action" defaultValue={value('action')} className="mt-1 block rounded border border-line px-2 py-1 text-sm">
            <option value="">Everything</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Who
          <select name="actor" defaultValue={value('actor')} className="mt-1 block rounded border border-line px-2 py-1 text-sm">
            <option value="">Anyone</option>
            {users.ok ? users.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>) : null}
          </select>
        </label>
        <ShowButton />
        <Link href="/audit" className="pb-1.5 text-sm text-accent underline">Clear</Link>
      </form>

      {r.rows.length === 0 ? (
        <Empty>Nothing recorded in the range.</Empty>
      ) : (
        <ActivityList>
          {r.rows.map((a) => (
            <ActivityRow key={a.id} when={lagosTime(a.occurredAt)}>
              <p className="text-sm font-medium text-ink">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</p>
              <ActivityMeta>by {a.actor?.label ?? '—'}</ActivityMeta>
              <Detail detail={a.detail} />
            </ActivityRow>
          ))}
        </ActivityList>
      )}
      <Pager links={pageLinks('/audit', input, r)} noun="entries" />
    </ReportFrame>
  );
}

function Detail({ detail }: { detail: AuditRow['detail'] }) {
  if (detail.length === 0) return null;
  return (
    <ul className="mt-1 text-xs text-ink-soft">
      {detail.map((d, i) => (
        <li key={i}>
          <span className="font-mono">{d.field}</span>: {'from' in d ? `${shown(d.field, d.from)} → ${shown(d.field, d.to)}` : shown(d.field, d.value)}
        </li>
      ))}
    </ul>
  );
}

/** An amount field (…Kobo) as naira; anything else as the backend wrote it. */
function shown(field: string, v: string | number | boolean | null | undefined): string {
  return /Kobo$/.test(field) && typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? naira(v) : String(v);
}
